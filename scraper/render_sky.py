"""Render latest/sky.png — the INSAT CTBT cloud field restyled as the site's
pixel art (day-sky blue, chunky white cloud blocks, ink national outline).

Reuses the cloud/temperature grids collect_obs already decoded, so it costs no
extra requests; a run without a fresh frame simply skips the image and the
previous one keeps serving.
"""

import datetime
import io
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from mosdac import BBOX, W, H

# site palette (src/lib/theme.ts): SKY.day.top, CLOUD.low.fill, CLOUD.middle.fill, UI.inkOnLight
SKY = (0x3A, 0x88, 0xCC)
CLOUD = (0xFF, 0xFF, 0xFF)
PARTIAL = (0xB7, 0xCF, 0xEA)
INK = (0x0B, 0x1D, 0x3A)
PAPER = (0xFD, 0xFB, 0xF4)

# Cloud-height shading from INSAT CTBT cloud-top temperature (deg C): cold,
# high/deep tops read bright white; warmer low cloud settles toward the sky, so
# the field isn't a flat white slab. Used only when a temperature frame is
# supplied; without one cloud falls back to flat CLOUD/PARTIAL. Stops are the
# (cold-side) temperature edges of each tier (cf. imd_sat.LAYER_HIGH_C/MID_C).
# High-contrast height ramp so layers read at a glance: sky -> faint low ->
# medium mid -> pale mid-high -> white deep/high. Muted tiers washed out the
# density, so these step down toward the sky more assertively.
CLOUD_MIDH = (0xC6, 0xDC, 0xF2)
CLOUD_MID = (0x8C, 0xB4, 0xDE)
CLOUD_LOW = (0x5C, 0x98, 0xCE)
TEMP_STOPS = ((-45, CLOUD), (-25, CLOUD_MIDH), (-8, CLOUD_MID))

CELL_SRC = 10  # source px per cell -> 136x128 cells over the obs bbox
SCALE = 6      # output px per cell
FULL, SOME = 0.7, 0.35  # cell cloud fraction -> solid / partial block
PARTIAL_MIX = 0.6  # partial cell blends its tone this far from sky toward cloud
STAMP_SCALE = 2  # nearest-neighbour upscale of the bitmap font -> pixel type

GEO = Path(__file__).resolve().parent.parent / "src/lib/assets/geo/india.json"


IST_OFFSET = datetime.timedelta(hours=5, minutes=30)


def _stamp_text(frame_dt):
    """'INSAT-3DR/3DS · 18 JUL 2026 · 21:30 IST (16:00 UTC)' from the frame time.

    The frame timestamp is UTC; we show local IST (the audience's clock) with
    UTC bracketed, and use the IST date so it stays correct across midnight.
    """
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


def _cellstack(grid, gh, gw):
    """Reshape an (H,W) grid into (gh, gw, CELL_SRC*CELL_SRC) per-cell stacks."""
    b = grid[: gh * CELL_SRC, : gw * CELL_SRC].reshape(gh, CELL_SRC, gw, CELL_SRC)
    return b.transpose(0, 2, 1, 3).reshape(gh, gw, -1)


def _blend(a, b, t):
    """Linear blend of colours a->b by t in [0,1]."""
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def _cloud_tone(o):
    """Cloud colour from a cell's mean cloud-top temperature (deg C): cold high
    tops bright, warm low cloud muted. NaN (no temp under the cloud) -> CLOUD."""
    if o is None or o != o:  # NaN
        return CLOUD
    for edge, col in TEMP_STOPS:
        if o < edge:
            return col
    return CLOUD_LOW


def render_sky(cloud, frame_dt=None, temp=None):
    """PNG bytes for the styled sky image, or None when the cloud grid is unusable.

    frame_dt, when given, is stamped onto the image as a pixel meta line.
    temp, when given (same HxW grid, deg C), shades cloud by cloud-top height so
    the field isn't a flat white slab; without it cloud renders flat CLOUD/PARTIAL.
    """
    if cloud is None or cloud.shape != (H, W):
        return None
    gh, gw = H // CELL_SRC, W // CELL_SRC
    blocks = _cellstack(cloud, gh, gw)
    valid = np.count_nonzero(~np.isnan(blocks), axis=2)
    if valid.sum() < blocks.shape[2] * gh * gw / 2:
        return None  # mostly-missing frame: keep serving the previous image
    with np.errstate(invalid="ignore"):
        frac = np.where(valid > blocks.shape[2] / 2, np.nanmean(blocks, axis=2), 0.0)

    # Per-cell mean temperature over the cloudy pixels only, to shade by height.
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
