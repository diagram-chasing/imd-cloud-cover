"""MausamGram MME numeric point forecasts (IMD, 0.125-degree grid, 00Z runs).

One JSON per grid cell per IC: 41 three-hourly steps (index 0 is the IC hour,
always "NaN"). Coords must be floored to the grid. The day's table fills
progressively, so collect() fetches everything and falls back wholesale to
yesterday's complete run (step shift +8) when coverage is poor.
"""

import datetime
import math
import random
import time
from concurrent.futures import ThreadPoolExecutor

import requests

from common import to_float

URL = "https://mausamgram.imd.gov.in/test4_mme.php"
GRID = 0.125
N_STEPS = 41
IST_OFFSET_STEPS = 2  # 00Z = 05:30 IST ~= 2 three-hour steps
MIN_COVERAGE = 0.9
MAX_WORKERS = 6


def snap(v):
    return math.floor(v / GRID) * GRID


def fetch_cell(lat, lon, ic, sess):
    """{"tc": [41], "p": [41]} (float-or-None) for one snapped cell, or None."""
    params = {"lat_gfs": f"{snap(lat):.3f}", "lon_gfs": f"{snap(lon):.3f}",
              "date": f"{ic}_3hr_0p125"}
    for attempt in range(3):
        try:
            time.sleep(random.uniform(0.1, 0.3))
            doc = sess.get(URL, params=params, timeout=20).json()
            tc, p = doc.get("tcdc"), doc.get("apcp")
            if not (isinstance(tc, list) and len(tc) == N_STEPS
                    and isinstance(p, list) and len(p) == N_STEPS):
                return None
            return {"tc": [to_float(v) for v in tc], "p": [to_float(v) for v in p]}
        except Exception:  # noqa: BLE001 — flaky govt endpoint; retry then give up
            if attempt == 2:
                return None
            time.sleep(2 ** attempt)


def align_indices(n_display, shift):
    """Model index per IST display step (8/day): k = 8d + j - 2 + shift,
    clamped to the valid 1..40 range (index 0 is the NaN IC hour)."""
    return [max(1, min(N_STEPS - 1, 8 * (i // 8) + i % 8 - IST_OFFSET_STEPS + shift))
            for i in range(n_display)]


def collect(stations, date, n_display_steps):
    """Fetch tcdc/apcp for every station ({code: (lat, lon)}), deduped by grid
    cell. Returns the numeric.json payload, or None when unreachable."""
    sess = requests.Session()
    sess.headers.update({"User-Agent": "Mozilla/5.0"})

    cells = {}
    for code, (lat, lon) in stations.items():
        cells.setdefault((snap(lat), snap(lon)), []).append(code)
    keys = sorted(cells)

    d = datetime.date.fromisoformat(date)
    best = None  # (coverage, ic, shift, fetched)
    for ic, shift in ((f"{d:%Y%m%d}00", 0),
                      (f"{d - datetime.timedelta(days=1):%Y%m%d}00", 8)):
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
            fetched = list(ex.map(lambda k: fetch_cell(k[0], k[1], ic, sess), keys))
        cov = sum(c is not None for c in fetched) / len(keys)
        if best is None or cov > best[0]:
            best = (cov, ic, shift, fetched)
        if cov >= MIN_COVERAGE:
            break
    coverage, ic, shift, fetched = best
    if coverage == 0:
        return None

    idx = align_indices(n_display_steps, shift)
    out = {}
    for key, cell in zip(keys, fetched):
        if cell is None:
            continue
        row = {"tc": [None if cell["tc"][k] is None else round(cell["tc"][k])
                      for k in idx],
               "p": [None if cell["p"][k] is None else round(max(0.0, cell["p"][k]), 1)
                     for k in idx]}
        for code in cells[key]:
            out[code] = row
    print(f"mausamgram: ic {ic} shift {shift}, "
          f"{sum(c is not None for c in fetched)}/{len(keys)} cells")
    return {"date": date, "ic": ic, "shift": shift,
            "steps": n_display_steps, "stations": out}
