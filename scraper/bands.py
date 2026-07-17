"""The day-0 band model shared by every view builder: parse raw
{date}/{code}-meteogram.json slices into h/m/l band lists and derive the
per-day stats (daily means, effective cover, history entries)."""

import re

from common import c100
from storage import pmap

STEPS = ["00:00", "03:00", "06:00", "09:00", "12:00", "15:00", "18:00", "21:00"]
DAY0_SAMPLES = 8
# Days of forecast to expose in latest/all-stations.json: day-0 plus the next
# (FORECAST_DAYS-1). The client shows the visitor's *current* IST day out of
# this window, so the site reads as "today" even before the day's scrape runs.
FORECAST_DAYS = 3

# One key per band; RAW_FIELDS maps view keys to raw-JSON field names.
BANDS = ("h", "m", "l", "e")
RAW_FIELDS = (("h", "high"), ("m", "middle"), ("l", "low"))

DATE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})/([A-Za-z0-9_-]+)-meteogram\.json$")
DATE_ONLY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def clampint(v):
    """c100 for raw OCR values: junk coerces to 0, not None."""
    try:
        return c100(float(v))
    except (TypeError, ValueError):
        return 0


def mean_round(vals):
    return round(sum(vals) / len(vals))


def forecast_bands(raw, n_days=FORECAST_DAYS):
    """{"h","m","l": up to n_days*8 ints each}, or None if unusable. slice day-0 with day0()."""
    data = raw.get("data")
    if not data or len(data) < DAY0_SAMPLES:
        return None
    sl = data[: n_days * DAY0_SAMPLES]
    return {k: [clampint(d.get(f)) for d in sl] for k, f in RAW_FIELDS}


def day0(bands):
    """The day-0 slice (first 8 steps) of a possibly multi-day bands dict.
    Carries the optional rain list `r` through when present."""
    keys = [k for k, _ in RAW_FIELDS] + (["r"] if "r" in bands else [])
    return {k: bands[k][:DAY0_SAMPLES] for k in keys}


def effective(b):
    """Per-step effective cover: max of the three cloud bands."""
    return [max(b["h"][i], b["m"][i], b["l"][i]) for i in range(len(b["h"]))]


def daily_means(b):
    """Per-band daily means plus effective mean `e` (mean of per-step max)."""
    means = {k: mean_round(b[k]) for k, _ in RAW_FIELDS}
    means["e"] = mean_round(effective(b))
    return means


def history_entry(b):
    """daily means plus t: the 8-step effective series (used by the station page)."""
    return {**daily_means(b), "t": effective(b)}


def read_slice(store, date, code):
    raw = store.get_json(f"{date}/{code}-meteogram.json")
    return forecast_bands(raw) if raw is not None else None


def read_slices(store, date, codes):
    """{code: multi-day bands} for every readable raw file of date, fetched concurrently."""
    bands = pmap(lambda c: read_slice(store, date, c), codes)
    return {c: b for c, b in zip(codes, bands) if b is not None}


def list_dates(store):
    """All snapshot dates, sorted ascending (one cheap delimited listing)."""
    names = (p.rstrip("/") for p in store.list_prefixes(""))
    return sorted(n for n in names if DATE_ONLY_RE.match(n))


def codes_for_date(store, date):
    matches = (DATE_RE.match(k) for k in store.list_keys(f"{date}/"))
    return sorted(m.group(2) for m in matches if m and m.group(1) == date)
