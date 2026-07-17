"""history/{code}.json documents: one file per station holding per-day daily
means, capped at HISTORY_CAP days. This module owns that retention policy."""

from bands import daily_means, day0, history_entry
from storage import SHORT, pmap

HISTORY_CAP = 400


def load_histories(store, manifest_codes):
    """{code: hist-or-None}, fetched concurrently into a single in-memory copy."""
    codes = sorted(manifest_codes)
    return dict(zip(codes, pmap(lambda c: store.get_json(f"history/{c}.json"), codes)))


def cap_days(hist):
    if len(hist["days"]) > HISTORY_CAP:
        hist["days"] = dict(sorted(hist["days"].items())[-HISTORY_CAP:])


def put_histories(store, histories, codes):
    pmap(lambda c: store.put_json(f"history/{c}.json", histories[c], cache_control=SHORT),
         codes)


def update_histories(store, date, slices, manifest_codes, histories):
    """merge today's daily means into histories and persist changed files. idempotent by date key."""
    today_means, changed = {}, []
    for code, b in slices.items():
        if code not in manifest_codes:
            continue
        b0 = day0(b)
        today_means[code] = daily_means(b0)
        hist = histories.get(code) or {"code": code, "kind": "day0-forecast", "days": {}}
        hist.setdefault("days", {})
        hist["days"][date] = history_entry(b0)
        cap_days(hist)
        histories[code] = hist
        changed.append(code)
    put_histories(store, histories, changed)
    return today_means
