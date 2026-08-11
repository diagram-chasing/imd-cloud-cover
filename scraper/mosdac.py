"""INSAT-3DS near-real-time cloud mask + rain rate from MOSDAC's live ncWMS.

One GetMap PNG per product over an India bbox, sampled locally — two requests
per run. Greyscale palettes decode linearly onto the requested value range:
CMK (cloud mask) renders binary black/white; HEM (Hydro-Estimator, mm/hr)
renders as 12 discrete grey bands of 2 mm/hr.
"""

import datetime
import io
import re

import numpy as np
from PIL import Image

from common import insecure_get

# Legacy file-index endpoint: returns full L2B filenames (incl. version suffix)
# for 3SIMG in one shot. Deprecated on the live site in favour of INITIAL_URL
# below, but still preferred here because it hands back the exact filename
# rather than one we have to reconstruct. Both share one MySQL file index; when
# that DB is unreachable every listing endpoint 500s (see latest_files).
LATEST_URL = ("https://mosdac.gov.in/live/backend/satellite_latest.php"
              "?file_prefix=3SIMG&param=addlayer&timezone=local"
              "&timezone_formal=19800&file_ext=")
# Current endpoint the live UI uses. Queried per product; returns a
# semicolon-split "datetime-list;prefix" body (see _parse_initial), from which
# we rebuild the filename. NOTE: response shape/params inferred from MOSDAC's
# minified JS and unverified while the backend DB is down — the legacy path is
# tried first, this is a fallback for if/when the old endpoint is retired.
INITIAL_URL = ("https://mosdac.gov.in/live/backend/satellite_data_initial.php"
               "?file_prefix=3SIMG&file_extension=L2B_{prod}&param=startlayer"
               "&timezone=local&timezone_formal=-19800")
L2B_PRODUCTS = ("CMK", "HEM", "OLR")
L2B_SUFFIX = "V01R00"  # version/revision tag in the reconstructed filename
WMS_BASE = "https://mosdac.gov.in/live_data/wms"

BBOX = (66.0, 6.0, 100.0, 38.0)  # lon0, lat0, lon1, lat1 (~0.025 deg/px)
W, H = 1360, 1280
MAX_AGE = datetime.timedelta(hours=3)
HEM_BANDS = 12
HEM_MM_PER_BAND = 2.0
# OLR (outgoing longwave radiation, W/m^2) is a cloud-top-temperature proxy:
# cold tops (low OLR) are high/deep cloud, warm (high OLR) is clear or low cloud.
# Thresholds validated against the CMK mask over a monsoon scene (2026-07-23).
OLR_MIN, OLR_MAX = 100.0, 300.0  # greyscale range requested from ncWMS
OLR_HIGH = 180  # < this => cold top => high/deep cloud
OLR_MID = 240   # 180..240 => mid; > 240 => low/warm cloud

_FILE_RE = re.compile(r"3SIMG_(\d{2})([A-Z]{3})(\d{4})_(\d{4})_L2B_(CMK|HEM|OLR)_\S+?\.h5")
_MONTHS = {m: i + 1 for i, m in enumerate(
    ["JAN", "FEB", "MAR", "APR", "MAY", "JUN",
     "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"])}


def _fresh(filename, now):
    """Parse an L2B filename's UTC timestamp; return it only if within MAX_AGE."""
    m = _FILE_RE.match(filename)
    if not m:
        return None
    day, mon, year, hhmm, _prod = m.groups()
    dt = datetime.datetime(int(year), _MONTHS[mon], int(day),
                           int(hhmm[:2]), int(hhmm[2:]),
                           tzinfo=datetime.timezone.utc)
    return dt if now - dt <= MAX_AGE else None


def _latest_via_legacy(now):
    """{prod: filename} from LATEST_URL, which dumps every product's real
    filename unordered — take the max fresh timestamp per product. Raises on a
    transport/HTTP error so the caller can log it and fall back."""
    text = insecure_get(LATEST_URL, timeout=45).decode("utf-8", "replace")
    best = {}
    for m in _FILE_RE.finditer(text):
        dt = _fresh(m.group(0), now)
        prod = m.group(5)
        if dt and (prod not in best or dt > best[prod][1]):
            best[prod] = (m.group(0), dt)
    return {prod: name for prod, (name, _) in best.items()}


def _parse_initial(text, prod, now):
    """Rebuild a filename from satellite_data_initial.php's "list;prefix" body.

    The list is comma-separated "SRC*DDMONYYYY HHMM" entries; the trailing
    field is the source prefix to keep. We take the newest matching entry and
    reconstruct 3SIMG_<date>_<time>_L2B_<prod>_<suffix>.h5, then re-validate it
    through the same freshness check. Returns a fresh filename or None."""
    parts = text.split(";")
    if len(parts) < 2:
        return None
    prefix = parts[1].strip()
    entries = [e[e.index("*") + 1:].strip() for e in parts[0].split(",")
               if "*" in e and (not prefix or prefix in e)]
    for val in reversed(entries):  # newest last
        date_part, _, time_part = val.partition(" ")
        fn = f"3SIMG_{date_part.strip()}_{time_part.strip()}_L2B_{prod}_{L2B_SUFFIX}.h5"
        if _fresh(fn, now):
            return fn
    return None


def _latest_via_initial(now):
    """{prod: filename} via the per-product current endpoint (INITIAL_URL).
    Best-effort: any product whose request or parse fails is simply omitted."""
    out = {}
    for prod in L2B_PRODUCTS:
        try:
            text = insecure_get(INITIAL_URL.format(prod=prod), timeout=45)
            fn = _parse_initial(text.decode("utf-8", "replace"), prod, now)
        except Exception:  # noqa: BLE001
            fn = None
        if fn:
            out[prod] = fn
    return out


def latest_files(now):
    """{"CMK": filename, ...} for the newest fresh scan of each product, or {}
    when every listing endpoint is unreachable.

    Prefers the legacy endpoint (hands back exact filenames); on its failure —
    typically the shared file-index DB being down — logs the reason and falls
    back to reconstructing filenames from the current per-product endpoint."""
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


def fetch_cmk_grid(filename):
    """0/1 cloud-mask grid (nan = missing), or None."""
    res = _fetch_grid(filename, "CMK", "0,1")
    if res is None:
        return None
    grey, valid = res
    return np.where(valid, (grey > 127).astype(np.float32), np.nan)


def fetch_hem_grid(filename):
    """Rain-rate grid in mm/hr (band lower edges; nan = missing), or None."""
    res = _fetch_grid(filename, "HEM", "0,24", HEM_BANDS)
    if res is None:
        return None
    grey, valid = res
    bands = np.round(grey * (HEM_BANDS - 1) / 255.0)
    return np.where(valid, bands * HEM_MM_PER_BAND, np.nan)


def fetch_olr_grid(filename):
    """Outgoing-longwave-radiation grid in W/m^2 (nan = missing), or None.
    Continuous greyscale decoding linearly onto [OLR_MIN, OLR_MAX]."""
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
