"""Render latest/sky.png — the INSAT-3DS cloud mask restyled as the site's
pixel art (day-sky blue, chunky white cloud blocks, ink national outline).

Reuses the CMK grid collect_obs already fetched, so it costs no extra
requests; a run without a fresh CMK frame simply skips the image and the
previous one keeps serving.
"""

import datetime
import io
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from mosdac import BBOX, W, H, _FILE_RE, _MONTHS

# site palette (src/lib/theme.ts): SKY.day.top, CLOUD.low.fill, CLOUD.middle.fill, UI.inkOnLight
SKY = (0x3A, 0x88, 0xCC)
CLOUD = (0xFF, 0xFF, 0xFF)
PARTIAL = (0xB7, 0xCF, 0xEA)
INK = (0x0B, 0x1D, 0x3A)
PAPER = (0xFD, 0xFB, 0xF4)

CELL_SRC = 10  # source px per cell -> 136x128 cells over the obs bbox
SCALE = 6      # output px per cell
FULL, SOME = 0.7, 0.35  # cell cloud fraction -> solid / partial block
STAMP_SCALE = 2  # nearest-neighbour upscale of the bitmap font -> pixel type

GEO = Path(__file__).resolve().parent.parent / "src/lib/assets/geo/india.json"


IST_OFFSET = datetime.timedelta(hours=5, minutes=30)


def _stamp_text(cmk_filename):
    """'INSAT-3DS · 18 JUL 2026 · 21:30 IST (16:00 UTC)' from the CMK filename.

    The frame timestamp is UTC; we show local IST (the audience's clock) with
    UTC bracketed, and use the IST date so it stays correct across midnight.
    """
    m = _FILE_RE.match(cmk_filename or "")
    if not m:
        return None
    day, mon, year, hhmm, _prod = m.groups()
    utc = datetime.datetime(int(year), _MONTHS[mon], int(day),
                            int(hhmm[:2]), int(hhmm[2:]))
    ist = utc + IST_OFFSET
    return (f"INSAT-3DS · {ist:%d %b %Y}".upper()
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
    # paper-tinted backing plate so the type stays legible over cloud or sky
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


def render_sky(cmk, cmk_filename=None):
    """PNG bytes for the styled sky image, or None when cmk is unusable.

    cmk_filename, when given, is stamped onto the image as a pixel meta line.
    """
    if cmk is None or cmk.shape != (H, W):
        return None
    gh, gw = H // CELL_SRC, W // CELL_SRC
    blocks = cmk[: gh * CELL_SRC, : gw * CELL_SRC].reshape(gh, CELL_SRC, gw, CELL_SRC)
    blocks = blocks.transpose(0, 2, 1, 3).reshape(gh, gw, -1)
    valid = np.count_nonzero(~np.isnan(blocks), axis=2)
    if valid.sum() < blocks.shape[2] * gh * gw / 2:
        return None  # mostly-missing frame: keep serving the previous image
    with np.errstate(invalid="ignore"):
        frac = np.where(valid > blocks.shape[2] / 2, np.nanmean(blocks, axis=2), 0.0)

    out_w, out_h = gw * SCALE, gh * SCALE
    img = Image.new("RGB", (out_w, out_h), SKY)
    d = ImageDraw.Draw(img)
    for y in range(gh):
        for x in range(gw):
            f = frac[y, x]
            if f < SOME:
                continue
            d.rectangle(
                [x * SCALE, y * SCALE, (x + 1) * SCALE - 1, (y + 1) * SCALE - 1],
                fill=CLOUD if f >= FULL else PARTIAL,
            )

    lon0, lat0, lon1, lat1 = BBOX

    def proj(lon, lat):
        return ((lon - lon0) / (lon1 - lon0) * out_w, (lat1 - lat) / (lat1 - lat0) * out_h)

    topo = json.loads(GEO.read_text())
    for pts in _outer_arcs(topo):
        d.line([proj(*p) for p in pts], fill=INK, width=3)

    stamp = _stamp_text(cmk_filename)
    if stamp:
        _draw_stamp(img, stamp)

    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()
