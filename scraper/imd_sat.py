"""INSAT-3DR/3DS cloud + cloud-top temperature from IMD's live CTBT product.

Replaces the MOSDAC ncWMS path (whose INSAT ingest froze on 23 Jul 2026). One
JPEG per run:

    https://mausam.imd.gov.in/Satellite/3Dasiasec_ctbt.jpg

Cloud-Top Brightness Temperature (TIR1 10.8um), L1C Mercator over the Asia
sector, ~30-min cadence, overwritten in place (frame time = HTTP Last-Modified).
It is self-geo-referenced (printed graticule) and self-legended (a discrete
colour bar), so we decode it entirely from pixels:

  * a palette of 4 saturated colours marks the coldest, highest cloud tops
    (bin centres -80/-65/-50/-35 C);
  * the greyscale background is inverted brightness temperature (brighter =
    colder = more cloud), which recovers the surrounding mid/low cloud shield.

Both are decoded and warped onto the SAME equirectangular (BBOX, W, H) grid
mosdac.py produces, so mosdac.sample() and render_sky consume the result
unchanged. Unlike the old binary CMK mask, this yields a graded cloud fraction
plus a real cloud-top temperature for layer classification.
"""

import datetime
import email.utils
import io
import math

import numpy as np
from PIL import Image

from common import insecure_get_meta
from mosdac import BBOX, W, H  # share the output grid so downstream is untouched

URL = "https://mausam.imd.gov.in/Satellite/3Dasiasec_ctbt.jpg"
MAX_AGE = datetime.timedelta(hours=2)

# --- source CTBT geo-reference (calibrated 2026-08-02 from the graticule;
# see tools/calibrate_ctbt.py to re-derive). lon linear, lat Mercator:
#   x = LON_A*lon + LON_B ;  y = LAT_A*ln(tan(pi/4 + lat/2)) + LAT_B
LON_A, LON_B = 18.38571, -632.4286
LAT_A, LAT_B = -1048.5766, 1020.9193
MAP_X0, MAP_X1 = 102, 1204   # frame columns (40E .. 100E)
MAP_Y0, MAP_Y1 = 90, 1212    # frame rows (~45N .. ~10S)
GRID_LON = (40, 50, 60, 70, 80, 90, 100)  # graticule lines to suppress
GRID_LAT = (0, 10, 20, 30, 40)

# Discrete colour-bar palette -> bin-centre cloud-top temperature (deg C).
PALETTE = np.array([[254, 0, 0], [161, 1, 199], [0, 254, 254], [0, 0, 254]], np.float32)
PALETTE_C = np.array([-80.0, -65.0, -50.0, -35.0], np.float32)
SAT_CLOUD = 0.30  # saturation above which a pixel is a palette (cold-cloud) colour

# Greyscale background = inverted brightness temperature (warm/clear dark, cold
# cloud bright). Linear ramps, tune from tools/validate_sources.py. CLEAR is set
# well above the warm-surface floor so only clearly-cold grey counts as cloud —
# otherwise haze/warm-surface reads as a near-total overcast wash. Grey cloud is
# by definition warmer than the palette's cold tops, so its temp range sits in
# the mid/low band (the palette owns high).
GREY_CLEAR, GREY_THICK = 178.0, 228.0   # brightness -> cloud fraction 0..1
GREY_WARM_C, GREY_COLD_C = 10.0, -30.0  # brightness endpoints -> deg C (coarse)
CLEAR_FRAC = 0.15  # cloud fraction below which a grey pixel is treated as clear

# Cloud-top temperature (deg C) -> layer, matching obs.ts's high/mid/low routing.
LAYER_HIGH_C = -45.0
LAYER_MID_C = -20.0


def layer_of(temp_c):
    """'high' | 'mid' | 'low' from a cloud-top temperature in deg C."""
    return ("high" if temp_c < LAYER_HIGH_C
            else "mid" if temp_c < LAYER_MID_C else "low")


def _frame_time(headers):
    """UTC datetime from the response Last-Modified header, or None."""
    lm = headers.get("Last-Modified") if headers else None
    if not lm:
        return None
    dt = email.utils.parsedate_to_datetime(lm)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt.astimezone(datetime.timezone.utc)


def latest_frame(now):
    """(jpeg_bytes, frame_dt_utc) for the current CTBT scan, or None when the
    fetch fails or the frame is older than MAX_AGE (job stalled / IMD down)."""
    try:
        data, headers = insecure_get_meta(URL, timeout=60)
    except Exception as e:  # noqa: BLE001
        print(f"imd_sat: fetch failed ({e!r})")
        return None
    dt = _frame_time(headers) or now
    if now - dt > MAX_AGE:
        print(f"imd_sat: frame stale (Last-Modified {dt.isoformat()})")
        return None
    return data, dt


def _decode(jpeg_bytes):
    """(cloud 0..1, temp deg C or nan) at the source image resolution.

    Palette colours -> cold cloud (fraction 1, bin temp); greyscale -> graded
    cloud from inverted brightness temperature. Non-map regions and clear grey
    pixels are nan in temp / 0 in cloud. Graticule lines are suppressed so they
    don't read as thin bright "cloud" stripes.
    """
    a = np.asarray(Image.open(io.BytesIO(jpeg_bytes)).convert("RGB"), np.float32)
    hs, ws, _ = a.shape
    mx = a.max(2)
    sat = np.where(mx > 0, (mx - a.min(2)) / np.maximum(mx, 1.0), 0.0)
    colored = sat > SAT_CLOUD

    # nearest palette colour -> bin temp (only meaningful where `colored`)
    d = np.linalg.norm(a[:, :, None, :] - PALETTE[None, None], axis=3)
    pal_c = PALETTE_C[d.argmin(2)]

    grey_cloud = np.clip((mx - GREY_CLEAR) / (GREY_THICK - GREY_CLEAR), 0.0, 1.0)
    grey_c = GREY_WARM_C + grey_cloud * (GREY_COLD_C - GREY_WARM_C)

    cloud = np.where(colored, 1.0, grey_cloud).astype(np.float32)
    temp = np.where(colored, pal_c,
                    np.where(grey_cloud > CLEAR_FRAC, grey_c, np.nan)).astype(np.float32)

    # blank everything outside the map frame (banner / colour bar / margins) to
    # nan = no data; inside the frame clear sky stays a valid 0.0 so the map can
    # still learn "it's actually clear" and trim an over-cloudy forecast.
    frame = np.zeros((hs, ws), bool)
    frame[MAP_Y0:MAP_Y1, MAP_X0:MAP_X1] = True
    cloud = np.where(frame, cloud, np.nan)
    temp = np.where(frame, temp, np.nan)

    for lon in GRID_LON:  # replace vertical graticule columns with a neighbour
        x = int(round(LON_A * lon + LON_B))
        for xx in (x - 1, x, x + 1):
            if 2 <= xx < ws:
                cloud[:, xx], temp[:, xx] = cloud[:, xx - 2], temp[:, xx - 2]
    for lat in GRID_LAT:  # and horizontal ones
        y = int(round(LAT_A * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) + LAT_B))
        for yy in (y - 1, y, y + 1):
            if 2 <= yy < hs:
                cloud[yy, :], temp[yy, :] = cloud[yy - 2, :], temp[yy - 2, :]
    return cloud, temp


def _warp(src, hs, ws, fill):
    """Resample a source (hs,ws) array onto the equirect (H,W) BBOX grid used by
    mosdac.sample()/render_sky. Nearest-neighbour via the CTBT calibration
    (lon linear, lat Mercator); out-of-frame samples get `fill`."""
    lon0, lat0, lon1, lat1 = BBOX
    lon = lon0 + np.arange(W) / (W - 1) * (lon1 - lon0)          # per output column
    lat = lat1 - np.arange(H) / (H - 1) * (lat1 - lat0)          # per output row
    sx = np.round(LON_A * lon + LON_B).astype(int)              # (W,)
    ymerc = np.log(np.tan(np.pi / 4 + np.radians(lat) / 2))
    sy = np.round(LAT_A * ymerc + LAT_B).astype(int)           # (H,)
    okx, oky = (sx >= 0) & (sx < ws), (sy >= 0) & (sy < hs)
    sx, sy = np.clip(sx, 0, ws - 1), np.clip(sy, 0, hs - 1)
    out = src[np.ix_(sy, sx)]
    out[~oky, :] = fill
    out[:, ~okx] = fill
    return out


def grids(jpeg_bytes):
    """(cloud, temp) as (H,W) grids on the BBOX equirect grid, or (None, None).

    cloud: 0..1 cloud fraction. temp: cloud-top temperature in deg C, nan where
    clear. Directly consumable by mosdac.sample() and render_sky.
    """
    try:
        csrc, tsrc = _decode(jpeg_bytes)
    except Exception as e:  # noqa: BLE001
        print(f"imd_sat: decode failed ({e!r})")
        return None, None
    hs, ws = csrc.shape
    cloud = _warp(csrc, hs, ws, np.nan)  # nan only where off the source frame
    temp = _warp(tsrc, hs, ws, np.nan)
    return cloud, temp
