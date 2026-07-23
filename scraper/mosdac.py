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

LATEST_URL = ("https://mosdac.gov.in/live/backend/satellite_latest.php"
              "?file_prefix=3SIMG&param=addlayer&timezone=local"
              "&timezone_formal=19800&file_ext=")
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


def latest_files(now):
    """{"CMK": filename, "HEM": filename} for the newest fresh scan of each
    product, or {} when the listing is unreachable. The listing dumps every
    product unordered, so take the max timestamp per product."""
    try:
        text = insecure_get(LATEST_URL, timeout=45).decode("utf-8", "replace")
    except Exception:  # noqa: BLE001
        return {}
    best = {}
    for m in _FILE_RE.finditer(text):
        day, mon, year, hhmm, prod = m.groups()
        dt = datetime.datetime(int(year), _MONTHS[mon], int(day),
                               int(hhmm[:2]), int(hhmm[2:]),
                               tzinfo=datetime.timezone.utc)
        if now - dt <= MAX_AGE and (prod not in best or dt > best[prod][1]):
            best[prod] = (m.group(0), dt)
    return {prod: name for prod, (name, _) in best.items()}


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
