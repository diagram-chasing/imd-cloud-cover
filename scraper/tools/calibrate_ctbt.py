"""One-off calibration for imd_sat.py against IMD's CTBT product.

The 3Dasiasec_ctbt.jpg frame is self-geo-referenced (a printed graticule) and
self-legended (a discrete colour bar). This downloads one frame, recovers the
constants imd_sat.py hard-codes, and writes an overlay to eyeball the fit:

  * lon->x  (linear) from the evenly spaced vertical graticule lines
  * lat->y  (Mercator) from the horizontal ones
  * the colour-bar bins + their deg-C tick labels

Run from scraper/:  python tools/calibrate_ctbt.py
Paste the printed constants into imd_sat.py if IMD ever re-lays-out the product.
"""

import json
import math
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import insecure_get  # noqa: E402
from imd_sat import URL  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
GEO = os.path.join(os.path.dirname(HERE), "..", "src/lib/assets/geo/india.json")


def _lines(score, n, sep=60):
    """The `n` strongest, well-separated peaks in a 1-D line-likeness score,
    returned sorted. Greedy: take the global max, blank +/- sep, repeat.

    `score` must reward pixels that are bright ALONG A WHOLE LINE (graticule),
    not isolated bright cloud — so peaks land on the graticule even on a cloudy
    frame. See how vscore/hscore are built in main()."""
    s = score.astype(float).copy()
    out = []
    for _ in range(n):
        i = int(s.argmax())
        if s[i] <= 0:
            break
        out.append(i)
        s[max(0, i - sep): i + sep] = 0
    return sorted(out)


def main():
    data = insecure_get(URL, timeout=60)
    a = np.asarray(Image.open(__import__("io").BytesIO(data)).convert("RGB")).astype(float)
    H, W, _ = a.shape
    val = a.max(2)
    sat = np.where(val > 0, (val - a.min(2)) / np.maximum(val, 1), 0)
    print(f"image {W}x{H}")

    # Graticule lines are thin, GREY (low saturation) and bright ALONG THEIR
    # WHOLE LENGTH; cloud is patchy and often coloured. A "line pixel" is bright
    # above its perpendicular-neighbour median AND grey, so lines win over cloud.
    yb0, yb1, xb0, xb1 = 100, 1205, 60, 1240
    band = val[yb0:yb1, xb0:xb1]
    grey = sat[yb0:yb1, xb0:xb1] < 0.15
    linev = (band > np.median(band, axis=1, keepdims=True) + 15) & grey
    lineh = (band > np.median(band, axis=0, keepdims=True) + 15) & grey
    vscore = linev.sum(0)  # per column
    hscore = lineh.sum(1)  # per row

    xs = [x + xb0 for x in _lines(vscore, 7)]     # 40..100E over the Asia sector
    print("vertical gridline x:", xs)
    lons = np.linspace(40, 100, len(xs))
    A = np.polyfit(lons, xs, 1)
    print(f"LON_A, LON_B = {A[0]:.5f}, {A[1]:.4f}")

    ys = [y + yb0 for y in _lines(hscore, 5)]      # 40,30,20,10,0 N top..bottom
    print("horizontal gridline y:", ys)
    lats = np.linspace(40, 0, len(ys))
    Y = np.log(np.tan(np.pi / 4 + np.radians(lats) / 2))
    B = np.polyfit(Y, ys, 1)
    print(f"LAT_A, LAT_B = {B[0]:.4f}, {B[1]:.4f}")
    print("lat residuals(px):", [round(float(p - r), 2) for p, r in zip(B[0] * Y + B[1], ys)])

    # colour bar: enumerate solid bins on a mid row of the bar band
    mx = a.max(2); sat = np.where(mx > 0, (mx - a.min(2)) / np.maximum(mx, 1), 0)
    bar_rows = [y for y in range(1245, 1300) if (sat[y] > 0.35).mean() > 0.5]
    if bar_rows:
        y = bar_rows[len(bar_rows) // 2]
        print(f"colour-bar rows {bar_rows[0]}..{bar_rows[-1]}; bins @ y={y}:")
        row = a[y].astype(int); x = 15; cur = None; start = 15
        while x < 1035:
            c = tuple(row[x])
            if cur is None or max(abs(c[i] - cur[i]) for i in range(3)) > 25:
                if cur is not None and x - start >= 8:
                    print("  ", (start, x - 1, tuple(np.median(a[y, start:x], 0).astype(int))))
                cur = c; start = x
            x += 1

    # overlay india outline for a visual sanity check of absolute lon/lat
    if len(xs) >= 2 and len(ys) >= 2 and os.path.exists(GEO):
        geo = json.load(open(GEO)); tr = geo["transform"]; sc = tr["scale"]; to = tr["translate"]
        arcs = []
        for arc in geo["arcs"]:
            px = py = 0; pts = []
            for dx, dy in arc:
                px += dx; py += dy; pts.append((px * sc[0] + to[0], py * sc[1] + to[1]))
            arcs.append(pts)
        img = np.asarray(Image.open(__import__("io").BytesIO(data)).convert("RGB")).copy()
        for arc in arcs:
            for lon, lat in arc:
                gx = int(round(A[0] * lon + A[1]))
                gy = int(round(B[0] * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) + B[1]))
                if 0 <= gx < W and 0 <= gy < H:
                    img[gy, gx] = [255, 255, 0]
        out = os.path.join(HERE, "ctbt_overlay.png")
        Image.fromarray(img).save(out)
        print("overlay ->", out)


if __name__ == "__main__":
    main()
