"""Build latest/obs.json — near-real-time observed cloud & rain per station —
plus the styled latest/sky.png and a daily QA archive. Runs every ~30 min
(obs-refresh.yml), independent of the daily pipeline: python obs.py

Each source is optional. Cloud = max of two satellite grids (IMD INSAT CTBT +
MOSDAC OLR); IMD synop adds observer oktas, present weather and 3-h rain via
the wmo join in stations.json. Both satellite decoders emit onto one shared
equirectangular (BBOX, W, H) grid so sample() and render_sky consume either.
"""

import datetime
import email.utils
import io
import json
import math
import re
import statistics
from pathlib import Path
from urllib.parse import urlencode

import numpy as np
from dotenv import load_dotenv
from PIL import Image, ImageDraw, ImageFont

from storage import (SHORT, c100, get_store, insecure_get, insecure_get_meta,
                     load_manifest, to_float)

load_dotenv()

BBOX = (66.0, 6.0, 100.0, 38.0)  # lon0, lat0, lon1, lat1 (~0.025 deg/px)
W, H = 1360, 1280


# MOSDAC INSAT-3DS live ncWMS: one GetMap PNG per product over the India bbox,
# sampled locally. Greyscale palettes decode linearly onto the requested value
# range. The legacy listing endpoint hands back exact L2B filenames; the
# "initial" endpoint (what the live UI now uses) only gives timestamps we
# rebuild filenames from, so legacy is tried first.
MOSDAC_LATEST_URL = ("https://mosdac.gov.in/live/backend/satellite_latest.php"
                     "?file_prefix=3SIMG&param=addlayer&timezone=local"
                     "&timezone_formal=19800&file_ext=")
MOSDAC_INITIAL_URL = ("https://mosdac.gov.in/live/backend/satellite_data_initial.php"
                      "?file_prefix=3SIMG&file_extension=L2B_{prod}&param=startlayer"
                      "&timezone=local&timezone_formal=-19800")
L2B_PRODUCTS = ("CMK", "HEM", "OLR")
L2B_SUFFIX = "V01R00"
WMS_BASE = "https://mosdac.gov.in/live_data/wms"

MOSDAC_MAX_AGE = datetime.timedelta(hours=3)
HEM_BANDS = 12
HEM_MM_PER_BAND = 2.0
# OLR (W/m^2) is a cloud-top-temperature proxy: cold tops (low OLR) are
# high/deep cloud. Thresholds validated against the CMK mask over a monsoon
# scene (2026-07-23).
OLR_MIN, OLR_MAX = 100.0, 300.0
OLR_HIGH = 180
OLR_MID = 240

_FILE_RE = re.compile(r"3SIMG_(\d{2})([A-Z]{3})(\d{4})_(\d{4})_L2B_(CMK|HEM|OLR)_\S+?\.h5")
_MONTHS = {m: i + 1 for i, m in enumerate(
    ["JAN", "FEB", "MAR", "APR", "MAY", "JUN",
     "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"])}


def _fresh(filename, now):
    m = _FILE_RE.match(filename)
    if not m:
        return None
    day, mon, year, hhmm, _prod = m.groups()
    dt = datetime.datetime(int(year), _MONTHS[mon], int(day),
                           int(hhmm[:2]), int(hhmm[2:]),
                           tzinfo=datetime.timezone.utc)
    return dt if now - dt <= MOSDAC_MAX_AGE else None


def _latest_via_legacy(now):
    text = insecure_get(MOSDAC_LATEST_URL, timeout=45).decode("utf-8", "replace")
    best = {}
    for m in _FILE_RE.finditer(text):
        dt = _fresh(m.group(0), now)
        prod = m.group(5)
        if dt and (prod not in best or dt > best[prod][1]):
            best[prod] = (m.group(0), dt)
    return {prod: name for prod, (name, _) in best.items()}


def _parse_initial(text, prod, now):
    """Rebuild a filename from the "list;prefix" body: comma-separated
    "SRC*DDMONYYYY HHMM" entries, newest last."""
    parts = text.split(";")
    if len(parts) < 2:
        return None
    prefix = parts[1].strip()
    entries = [e[e.index("*") + 1:].strip() for e in parts[0].split(",")
               if "*" in e and (not prefix or prefix in e)]
    for val in reversed(entries):
        date_part, _, time_part = val.partition(" ")
        fn = f"3SIMG_{date_part.strip()}_{time_part.strip()}_L2B_{prod}_{L2B_SUFFIX}.h5"
        if _fresh(fn, now):
            return fn
    return None


def _latest_via_initial(now):
    out = {}
    for prod in L2B_PRODUCTS:
        try:
            text = insecure_get(MOSDAC_INITIAL_URL.format(prod=prod), timeout=45)
            fn = _parse_initial(text.decode("utf-8", "replace"), prod, now)
        except Exception:  # noqa: BLE001
            fn = None
        if fn:
            out[prod] = fn
    return out


def latest_files(now):
    """{"CMK": filename, ...} for the newest fresh scan of each product, or {}
    when every listing endpoint is unreachable."""
    try:
        files = _latest_via_legacy(now)
        if files:
            return files
        print("mosdac: legacy listing returned no fresh products; trying fallback")
    except Exception as e:  # noqa: BLE001
        print(f"mosdac: legacy listing failed ({e!r}); trying fallback")
    files = _latest_via_initial(now)
    if not files:
        print("mosdac: no listing endpoint yielded fresh L2B files "
              "(MOSDAC file index likely down)")
    return files


def _fetch_grid(filename, layer, colorscalerange, numcolorbands=""):
    """(grey HxW float, valid HxW bool) from a GetMap render, or None."""
    m = _FILE_RE.match(filename)
    url = (f"{WMS_BASE}/live3SL2B{layer}/products/Insat3s/3S_IMG/"
           f"{m.group(3)}/{m.group(1)}{m.group(2)}/{filename}"
           f"?service=WMS&version=1.1.1&request=GetMap&layers={layer}"
           f"&srs=EPSG:4326&bbox={BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]}"
           f"&width={W}&height={H}&format=image/png&transparent=true"
           f"&styles=boxfill/greyscale&colorscalerange={colorscalerange}"
           + (f"&numcolorbands={numcolorbands}" if numcolorbands else ""))
    try:
        a = np.asarray(Image.open(io.BytesIO(insecure_get(url, timeout=90))).convert("RGBA"),
                       dtype=np.float32)
    except Exception:  # noqa: BLE001
        return None
    return a[..., 0], a[..., 3] > 0


def fetch_hem_grid(filename):
    """Rain-rate grid in mm/hr (band lower edges; nan = missing), or None."""
    res = _fetch_grid(filename, "HEM", "0,24", HEM_BANDS)
    if res is None:
        return None
    grey, valid = res
    bands = np.round(grey * (HEM_BANDS - 1) / 255.0)
    return np.where(valid, bands * HEM_MM_PER_BAND, np.nan)


def fetch_olr_grid(filename):
    """OLR grid in W/m^2 (nan = missing), or None."""
    res = _fetch_grid(filename, "OLR", f"{int(OLR_MIN)},{int(OLR_MAX)}")
    if res is None:
        return None
    grey, valid = res
    wm2 = OLR_MIN + grey / 255.0 * (OLR_MAX - OLR_MIN)
    return np.where(valid, wm2, np.nan)


def olr_to_frac(grid):
    """OLR (W/m^2) -> cloud fraction 0..1, or None. Ramp endpoints from the
    2026-07-23 CMK cross-check (cloudy median ~209, clear ~261)."""
    if grid is None:
        return None
    return np.clip((265.0 - grid) / (265.0 - 200.0), 0.0, 1.0)


def sample(grid, lat, lon, k=2):
    """Mean of the (2k+1)^2 neighbourhood (~13 km) at lat/lon, or None."""
    if grid is None:
        return None
    lon0, lat0, lon1, lat1 = BBOX
    if not (lon0 <= lon <= lon1 and lat0 <= lat <= lat1):
        return None
    x = int((lon - lon0) / (lon1 - lon0) * (W - 1))
    y = int((lat1 - lat) / (lat1 - lat0) * (H - 1))
    win = grid[max(0, y - k): y + k + 1, max(0, x - k): x + k + 1]
    if np.count_nonzero(~np.isnan(win)) < win.size / 2:
        return None
    return float(np.nanmean(win))


# IMD's live CTBT product (Cloud-Top Brightness Temperature, TIR1 10.8um, L1C
# Mercator over the Asia sector, ~30-min cadence, overwritten in place — frame
# time = HTTP Last-Modified). Self-geo-referenced and self-legended, so it is
# decoded entirely from pixels: 4 saturated palette colours mark the coldest
# tops (bin centres -80/-65/-50/-35 C), the greyscale background is inverted
# brightness temperature (brighter = colder = more cloud).
CTBT_URL = "https://mausam.imd.gov.in/Satellite/3Dasiasec_ctbt.jpg"
CTBT_MAX_AGE = datetime.timedelta(hours=2)

# Geo-reference calibrated 2026-08-02 from the printed graticule.
# x = LON_A*lon + LON_B ;  y = LAT_A*ln(tan(pi/4 + lat/2)) + LAT_B
LON_A, LON_B = 18.38571, -632.4286
LAT_A, LAT_B = -1048.5766, 1020.9193
MAP_X0, MAP_X1 = 102, 1204   # frame columns (40E .. 100E)
MAP_Y0, MAP_Y1 = 90, 1212    # frame rows (~45N .. ~10S)
GRID_LON = (40, 50, 60, 70, 80, 90, 100)  # graticule lines to suppress
GRID_LAT = (0, 10, 20, 30, 40)

PALETTE = np.array([[254, 0, 0], [161, 1, 199], [0, 254, 254], [0, 0, 254]], np.float32)
PALETTE_C = np.array([-80.0, -65.0, -50.0, -35.0], np.float32)
SAT_CLOUD = 0.30  # saturation above which a pixel is a palette (cold-cloud) colour

# GREY_CLEAR history: 130 read as all-overcast, 178 as all-clear; 150 is the
# middle, and sat_trust guards both failure modes.
GREY_CLEAR, GREY_THICK = 150.0, 215.0   # brightness -> cloud fraction 0..1
GREY_WARM_C, GREY_COLD_C = 10.0, -30.0  # brightness endpoints -> deg C (coarse)
CLEAR_FRAC = 0.15  # cloud fraction below which a grey pixel is treated as clear

# Cloud-top temperature (deg C) -> layer, matching obs.ts's high/mid/low routing.
LAYER_HIGH_C = -45.0
LAYER_MID_C = -20.0


def layer_of(temp_c):
    return ("high" if temp_c < LAYER_HIGH_C
            else "mid" if temp_c < LAYER_MID_C else "low")


def _frame_time(headers):
    lm = headers.get("Last-Modified") if headers else None
    if not lm:
        return None
    dt = email.utils.parsedate_to_datetime(lm)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt.astimezone(datetime.timezone.utc)


def latest_frame(now):
    """(jpeg_bytes, frame_dt_utc) for the current CTBT scan, or None when the
    fetch fails or the frame is older than CTBT_MAX_AGE."""
    try:
        data, headers = insecure_get_meta(CTBT_URL, timeout=60)
    except Exception as e:  # noqa: BLE001
        print(f"imd_sat: fetch failed ({e!r})")
        return None
    dt = _frame_time(headers) or now
    if now - dt > CTBT_MAX_AGE:
        print(f"imd_sat: frame stale (Last-Modified {dt.isoformat()})")
        return None
    return data, dt


def _decode(jpeg_bytes):
    """(cloud 0..1, temp deg C or nan) at the source image resolution."""
    a = np.asarray(Image.open(io.BytesIO(jpeg_bytes)).convert("RGB"), np.float32)
    hs, ws, _ = a.shape
    mx = a.max(2)
    sat = np.where(mx > 0, (mx - a.min(2)) / np.maximum(mx, 1.0), 0.0)
    colored = sat > SAT_CLOUD

    d = np.linalg.norm(a[:, :, None, :] - PALETTE[None, None], axis=3)
    pal_c = PALETTE_C[d.argmin(2)]

    grey_cloud = np.clip((mx - GREY_CLEAR) / (GREY_THICK - GREY_CLEAR), 0.0, 1.0)
    grey_c = GREY_WARM_C + grey_cloud * (GREY_COLD_C - GREY_WARM_C)

    cloud = np.where(colored, 1.0, grey_cloud).astype(np.float32)
    temp = np.where(colored, pal_c,
                    np.where(grey_cloud > CLEAR_FRAC, grey_c, np.nan)).astype(np.float32)

    # Blank everything outside the map frame (banner / colour bar / margins) to
    # nan; inside the frame clear sky stays a valid 0.0 so the map can still
    # learn "it's actually clear" and trim an over-cloudy forecast.
    frame = np.zeros((hs, ws), bool)
    frame[MAP_Y0:MAP_Y1, MAP_X0:MAP_X1] = True
    cloud = np.where(frame, cloud, np.nan)
    temp = np.where(frame, temp, np.nan)

    # Graticule lines would read as thin bright "cloud" stripes; replace each
    # with a neighbouring column/row.
    for lon in GRID_LON:
        x = int(round(LON_A * lon + LON_B))
        for xx in (x - 1, x, x + 1):
            if 2 <= xx < ws:
                cloud[:, xx], temp[:, xx] = cloud[:, xx - 2], temp[:, xx - 2]
    for lat in GRID_LAT:
        y = int(round(LAT_A * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) + LAT_B))
        for yy in (y - 1, y, y + 1):
            if 2 <= yy < hs:
                cloud[yy, :], temp[yy, :] = cloud[yy - 2, :], temp[yy - 2, :]
    return cloud, temp


def _warp(src, hs, ws, fill):
    """Nearest-neighbour resample from CTBT source pixels onto the (H,W) BBOX
    grid; out-of-frame samples get `fill`."""
    lon0, lat0, lon1, lat1 = BBOX
    lon = lon0 + np.arange(W) / (W - 1) * (lon1 - lon0)
    lat = lat1 - np.arange(H) / (H - 1) * (lat1 - lat0)
    sx = np.round(LON_A * lon + LON_B).astype(int)
    ymerc = np.log(np.tan(np.pi / 4 + np.radians(lat) / 2))
    sy = np.round(LAT_A * ymerc + LAT_B).astype(int)
    okx, oky = (sx >= 0) & (sx < ws), (sy >= 0) & (sy < hs)
    sx, sy = np.clip(sx, 0, ws - 1), np.clip(sy, 0, hs - 1)
    out = src[np.ix_(sy, sx)]
    out[~oky, :] = fill
    out[:, ~okx] = fill
    return out


def grids(jpeg_bytes):
    """(cloud 0..1, cloud-top temp deg C nan-where-clear) as (H,W) grids on the
    BBOX grid, or (None, None)."""
    try:
        csrc, tsrc = _decode(jpeg_bytes)
    except Exception as e:  # noqa: BLE001
        print(f"imd_sat: decode failed ({e!r})")
        return None, None
    hs, ws = csrc.shape
    cloud = _warp(csrc, hs, ws, np.nan)
    temp = _warp(tsrc, hs, ws, np.nan)
    return cloud, temp


SYNOP_URL = "https://reactjs.imd.gov.in/geoserver/imd/wfs?" + urlencode({
    "service": "WFS", "version": "1.0.0", "request": "GetFeature",
    "typeName": "imd:synop_data_layer", "outputFormat": "application/json",
    "srsName": "EPSG:4326",
})


def fetch_synop():
    """{wmo_id(str): {"ok" oktas, "wx" code, "r3" mm, "t" utc-datetime}} or None."""
    try:
        feats = json.loads(insecure_get(SYNOP_URL, timeout=120))["features"]
    except Exception:  # noqa: BLE001 — govt endpoint; absence is a normal state
        return None

    out = {}
    for f in feats:
        p = f["properties"]
        if p.get("station_id") is None:
            continue
        ok = to_float(p.get("nebulosity"))
        wx = p.get("weather")
        try:
            d = datetime.date.fromisoformat(str(p["dat"]).rstrip("Z"))
            t = datetime.datetime(d.year, d.month, d.day, int(p["utc"]),
                                  tzinfo=datetime.timezone.utc)
        except (KeyError, TypeError, ValueError):
            t = None
        out[str(p["station_id"])] = {
            "ok": int(ok) if ok is not None and 0 <= ok <= 8 else None,
            "wx": int(wx) if isinstance(wx, (int, float)) else None,
            "r3": to_float(p.get("3hrlyrain")),
            "t": t,
        }
    return out


# latest/sky.png: the CTBT cloud field restyled as the site's pixel art.
# Site palette (src/lib/theme.ts): SKY.day.top, CLOUD.low.fill,
# CLOUD.middle.fill, UI.inkOnLight.
SKY = (0x3A, 0x88, 0xCC)
CLOUD = (0xFF, 0xFF, 0xFF)
PARTIAL = (0xB7, 0xCF, 0xEA)
INK = (0x0B, 0x1D, 0x3A)
PAPER = (0xFD, 0xFB, 0xF4)

# Cloud-height shading from cloud-top temperature: cold high/deep tops read
# bright white, warmer low cloud settles toward the sky. Stops are the
# cold-side temperature edges of each tier (cf. LAYER_HIGH_C/MID_C).
CLOUD_MIDH = (0xC6, 0xDC, 0xF2)
CLOUD_MID = (0x8C, 0xB4, 0xDE)
CLOUD_LOW = (0x5C, 0x98, 0xCE)
TEMP_STOPS = ((-45, CLOUD), (-25, CLOUD_MIDH), (-8, CLOUD_MID))

CELL_SRC = 10  # source px per cell -> 136x128 cells over the obs bbox
SCALE = 6      # output px per cell
FULL, SOME = 0.7, 0.35  # cell cloud fraction -> solid / partial block
PARTIAL_MIX = 0.6
STAMP_SCALE = 2

GEO = Path(__file__).resolve().parent.parent / "src/lib/assets/geo/india.json"

IST_OFFSET = datetime.timedelta(hours=5, minutes=30)


def _stamp_text(frame_dt):
    if frame_dt is None:
        return None
    utc = frame_dt.astimezone(datetime.timezone.utc).replace(tzinfo=None)
    ist = utc + IST_OFFSET
    return (f"INSAT-3DR/3DS · {ist:%d %b %Y}".upper()
            + f" · {ist:%H:%M} IST ({utc:%H:%M} UTC)")


def _draw_stamp(img, text):
    """Burn a retro pixel meta line into the bottom-left corner (in place)."""
    font = ImageFont.load_default()
    l, t, r, b = font.getbbox(text)
    tw, th = r - l, b - t
    chip = Image.new("RGBA", (tw + 2, th + 2), (0, 0, 0, 0))
    ImageDraw.Draw(chip).text((1 - l, 1 - t), text, font=font, fill=INK + (255,))
    chip = chip.resize((chip.width * STAMP_SCALE, chip.height * STAMP_SCALE), Image.NEAREST)
    pad = SCALE
    x, y = pad, img.height - chip.height - pad
    plate = Image.new("RGB", (chip.width + 2 * pad, chip.height + pad), PAPER)
    img.paste(plate, (0, y - pad // 2))
    img.paste(chip, (x, y), chip)


def _outer_arcs(topo):
    """Decoded arc polylines used by exactly one state ring = national outline."""
    sc, tr = topo["transform"]["scale"], topo["transform"]["translate"]
    arcs = []
    for arc in topo["arcs"]:
        x = y = 0
        pts = []
        for dx, dy in arc:
            x += dx
            y += dy
            pts.append((x * sc[0] + tr[0], y * sc[1] + tr[1]))
        arcs.append(pts)

    def rings(g):
        if g.get("type") == "Polygon":
            return g["arcs"]
        if g.get("type") == "MultiPolygon":
            return [r for p in g["arcs"] for r in p]
        return []

    use = {}
    for g in topo["objects"]["states"]["geometries"]:
        for ring in rings(g):
            for ai in ring:
                i = ai if ai >= 0 else ~ai
                use[i] = use.get(i, 0) + 1
    return [arcs[i] for i, n in use.items() if n == 1]


def _cellstack(grid, gh, gw):
    b = grid[: gh * CELL_SRC, : gw * CELL_SRC].reshape(gh, CELL_SRC, gw, CELL_SRC)
    return b.transpose(0, 2, 1, 3).reshape(gh, gw, -1)


def _blend(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def _cloud_tone(o):
    if o is None or o != o:  # NaN
        return CLOUD
    for edge, col in TEMP_STOPS:
        if o < edge:
            return col
    return CLOUD_LOW


def render_sky(cloud, frame_dt=None, temp=None):
    """PNG bytes for the styled sky image, or None when the cloud grid is
    unusable. temp (same HxW grid, deg C) shades cloud by cloud-top height."""
    if cloud is None or cloud.shape != (H, W):
        return None
    gh, gw = H // CELL_SRC, W // CELL_SRC
    blocks = _cellstack(cloud, gh, gw)
    valid = np.count_nonzero(~np.isnan(blocks), axis=2)
    if valid.sum() < blocks.shape[2] * gh * gw / 2:
        return None  # mostly-missing frame: keep serving the previous image
    with np.errstate(invalid="ignore"):
        frac = np.where(valid > blocks.shape[2] / 2, np.nanmean(blocks, axis=2), 0.0)

    omean = None
    if temp is not None and temp.shape == (H, W):
        oblocks = _cellstack(temp, gh, gw)
        ocloud = np.where(blocks > 0.5, oblocks, np.nan)
        has = np.count_nonzero(~np.isnan(ocloud), axis=2)
        # nansum (not nanmean) so all-clear cells don't warn on an empty slice
        omean = np.where(has > 0, np.nansum(ocloud, axis=2) / np.maximum(has, 1), np.nan)

    out_w, out_h = gw * SCALE, gh * SCALE
    img = Image.new("RGB", (out_w, out_h), SKY)
    d = ImageDraw.Draw(img)
    for y in range(gh):
        for x in range(gw):
            f = frac[y, x]
            if f < SOME:
                continue
            if omean is not None:
                base = _cloud_tone(omean[y, x])
                col = base if f >= FULL else _blend(SKY, base, PARTIAL_MIX)
            else:
                col = CLOUD if f >= FULL else PARTIAL
            d.rectangle(
                [x * SCALE, y * SCALE, (x + 1) * SCALE - 1, (y + 1) * SCALE - 1],
                fill=col,
            )

    lon0, lat0, lon1, lat1 = BBOX

    def proj(lon, lat):
        return ((lon - lon0) / (lon1 - lon0) * out_w, (lat1 - lat) / (lat1 - lat0) * out_h)

    topo = json.loads(GEO.read_text())
    for pts in _outer_arcs(topo):
        d.line([proj(*p) for p in pts], fill=INK, width=3)

    stamp = _stamp_text(frame_dt)
    if stamp:
        _draw_stamp(img, stamp)

    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


SYNOP_MAX_AGE = datetime.timedelta(hours=4.5)
ARCHIVE_KEEP = 60  # snapshots per daily QA archive file
LAYER_CLOUD_GATE = 40  # need cloud % >= this before a cloud layer is meaningful


def build_obs(now):
    frame = latest_frame(now)
    cloud, temp = grids(frame[0]) if frame else (None, None)
    ctbt_dt = frame[1] if frame else None

    mfiles = latest_files(now)
    hem = fetch_hem_grid(mfiles["HEM"]) if "HEM" in mfiles else None
    molr = fetch_olr_grid(mfiles["OLR"]) if "OLR" in mfiles else None
    syn = fetch_synop()

    # Each satellite misses different cloud; take whichever shows more.
    olr_cloud = olr_to_frac(molr)
    if cloud is not None and olr_cloud is not None:
        cloud = np.fmax(cloud, olr_cloud)
    elif cloud is None:
        cloud = olr_cloud

    stations = {}
    for code, s in load_manifest()["stations"].items():
        row = {}
        sc = sample(cloud, s["lat"], s["lon"])
        if sc is not None:
            row["sc"] = c100(sc * 100)
        rr = sample(hem, s["lat"], s["lon"])
        if rr:
            row["rr"] = round(rr, 1)

        # Cloud-top height/layer, only where the mask agrees there's cloud to
        # place. Prefer CTBT temperature; fall back to MOSDAC OLR.
        if row.get("sc", 0) >= LAYER_CLOUD_GATE:
            tc = sample(temp, s["lat"], s["lon"])
            if tc is not None:
                row["ol"] = round(tc)
                row["layer"] = layer_of(tc)
            else:
                ow = sample(molr, s["lat"], s["lon"])
                if ow is not None:
                    row["ol"] = round(ow)
                    row["layer"] = ("high" if ow < OLR_HIGH
                                    else "mid" if ow < OLR_MID else "low")

        ob = syn.get(str(s.get("wmo"))) if syn and s.get("wmo") else None
        if ob and ob["t"] and now - ob["t"] <= SYNOP_MAX_AGE:
            if ob["ok"] is not None:
                row["ok"] = ob["ok"]
            if ob["wx"] is not None:
                row["wx"] = ob["wx"]
            if ob["r3"]:
                row["r3"] = round(ob["r3"], 1)

        # Merged observed cloud %. The IR mask is binary (cloud present, not
        # sky fraction) and saturates to ~0/100 at station scale, so weight
        # the observer's oktas higher when both are fresh.
        okpct = row["ok"] / 8 * 100 if "ok" in row else None
        if "sc" in row and okpct is not None:
            row["oc"] = c100(0.4 * row["sc"] + 0.6 * okpct)
        elif okpct is not None:
            row["oc"] = c100(okpct)
        elif "sc" in row:
            row["oc"] = row["sc"]

        if row:
            stations[code] = row

    syn_t = max((o["t"] for o in syn.values() if o["t"]), default=None) if syn else None
    return {
        "generated_at": now.isoformat(timespec="seconds"),
        "sources": {
            "synop": syn_t and syn_t.isoformat(timespec="seconds"),
            "ctbt": ctbt_dt and ctbt_dt.isoformat(timespec="seconds"),
            "hem": mfiles.get("HEM") if hem is not None else None,
            "olr": mfiles.get("OLR") if molr is not None else None,
            "sat": sat_trust(stations),
        },
        "stations": stations,
    }, cloud, ctbt_dt, temp


def sat_trust(stations):
    """Satellite-vs-observer check: {bias, mae, n, ok} or None. obs.ts only
    lets the satellite erase forecast cloud when ok is true."""
    diffs = [r["sc"] - r["ok"] / 8 * 100
             for r in stations.values() if "sc" in r and "ok" in r]
    if not diffs:
        return None
    bias = statistics.median(diffs)
    mae = statistics.mean(abs(d) for d in diffs)
    return {"bias": round(bias), "mae": round(mae), "n": len(diffs),
            "ok": len(diffs) >= 30 and abs(bias) <= 20 and mae <= 30}


def append_archive(store, doc, now):
    key = f"obs/archive/{now.date().isoformat()}.json"
    try:
        arch = store.get_json(key) or {"date": now.date().isoformat(), "snapshots": []}
        arch["snapshots"].append({
            "t": doc["generated_at"], "sources": doc["sources"],
            "stations": {c: r for c, r in doc["stations"].items()
                         if "ok" in r or "wx" in r}})
        arch["snapshots"] = arch["snapshots"][-ARCHIVE_KEEP:]
        store.put_json(key, arch, cache_control=SHORT)
    except Exception as e:  # noqa: BLE001 — QA trail must never fail the run
        print(f"archive append failed (ignored): {e}")


def put_sky(store, cloud, frame_dt, temp=None):
    try:
        png = render_sky(cloud, frame_dt, temp)
        if png:
            store.put_bytes("latest/sky.png", png, "image/png",
                            cache_control=SHORT)
            print(f"Wrote latest/sky.png ({len(png) // 1024} KB)")
    except Exception as e:  # noqa: BLE001 — illustration must never fail the run
        print(f"sky render failed (ignored): {e}")


def main():
    now = datetime.datetime.now(datetime.timezone.utc)
    doc, cloud, frame_dt, temp = build_obs(now)
    store = get_store()
    store.put_json("latest/obs.json", doc, cache_control="public, max-age=60")
    print(f"Wrote latest/obs.json: {len(doc['stations'])} stations, "
          f"sources {doc['sources']}")
    put_sky(store, cloud, frame_dt, temp)
    append_archive(store, doc, now)


if __name__ == "__main__":
    main()
