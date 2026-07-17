"""Anchor pixel-extracted cloud bands to MausamGram MME total cloud.

The meteogram OCR gives an h/m/l split the numeric feed lacks; the MME gives
a trustworthy total the OCR sometimes badly misses. Keep the split, pull the
effective total halfway toward the MME when they disagree beyond a tolerance,
and carry the MME's precip along as the rain channel.
"""

from common import c100

BETA = 0.5      # blend toward the MME total (0.5 = split the difference)
TOL = 20        # agreement window in cover points
EFF_FLOOR = 10  # below this the OCR shows essentially clear...
TC_CLOUDY = 40  # ...and an MME total >= this means "inject missing cloud"
RAIN_VISIBLE = 1.0     # mm/3h at which the map shows rain (theme.ts rainTier)
RAIN_CLOUD_FLOOR = 30  # raining => there IS cloud; keep a low-band sprite visible


def anchor_bands(bands, tc):
    """Mutate {"h","m","l"} lists toward the aligned MME totals `tc`."""
    n = 0
    for i in range(min(len(bands["h"]), len(tc))):
        t = tc[i]
        if t is None:
            continue
        eff = max(bands["h"][i], bands["m"][i], bands["l"][i])
        if abs(t - eff) <= TOL:
            continue
        if eff >= EFF_FLOOR:
            s = max(0.25, min(4.0, t / eff))
            for k in ("h", "m", "l"):
                v = bands[k][i]
                bands[k][i] = c100(v + BETA * (min(100, v * s) - v))
        elif t >= TC_CLOUDY:
            # OCR says clear, ensemble says cloudy — the classic failure mode.
            # Middle is the least assertive band: "cloud, altitude unknown".
            bands["m"][i] = max(bands["m"][i], c100(BETA * t))
        else:
            continue
        n += 1
    return n


def apply_anchoring(slices, numeric):
    """Anchor every station in place against {date}/numeric.json (or None).
    Returns a small report for reports/{date}.json."""
    if not numeric:
        return {"anchored": False}
    n = sum(anchor_bands(b, numeric["stations"][c]["tc"])
            for c, b in slices.items() if c in numeric["stations"])
    return {"anchored": True, "ic": numeric["ic"], "shift": numeric["shift"],
            "steps_anchored": n}


def attach_rain(slices, numeric):
    """Attach aligned MME precip as `r` (mm/3h), flooring the low band where
    it rains so the map never draws streaks out of an empty sky."""
    if not numeric:
        return
    for code, bands in slices.items():
        num = numeric["stations"].get(code)
        if not num:
            continue
        n = len(bands["h"])
        r = [v or 0.0 for v in num["p"][:n]]
        bands["r"] = r + [0.0] * (n - len(r))
        for i, v in enumerate(r):
            if v >= RAIN_VISIBLE and bands["l"][i] < RAIN_CLOUD_FLOOR:
                bands["l"][i] = RAIN_CLOUD_FLOOR
