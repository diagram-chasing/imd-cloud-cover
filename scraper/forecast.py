"""The forecast domain model shared by the pipeline's view builders: parse raw
{date}/{code}-meteogram.json slices into h/m/l band lists, derive per-day stats,
anchor bands to the MausamGram MME total, maintain history/{CODE}.json
documents, and build the city-explorer view (rollups/cities.json).
Imported by pipeline.py; not run directly.
"""

import datetime
import re

from storage import SHORT, c100, haversine_km, pmap

STEPS = ["00:00", "03:00", "06:00", "09:00", "12:00", "15:00", "18:00", "21:00"]
DAY0_SAMPLES = 8
# Day-0 plus the next (FORECAST_DAYS-1) days go into latest/all-stations.json;
# the client shows the visitor's current IST day out of this window, so the
# site reads as "today" even before the day's scrape runs.
FORECAST_DAYS = 3

BANDS = ("h", "m", "l", "e")
RAW_FIELDS = (("h", "high"), ("m", "middle"), ("l", "low"))

DATE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})/([A-Za-z0-9_-]+)-meteogram\.json$")
DATE_ONLY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

HISTORY_CAP = 400


def clampint(v):
    """c100 for raw OCR values: junk coerces to 0, not None."""
    try:
        return c100(float(v))
    except (TypeError, ValueError):
        return 0


def mean_round(vals):
    return round(sum(vals) / len(vals))


def forecast_bands(raw, n_days=FORECAST_DAYS):
    """{"h","m","l": up to n_days*8 ints each}, or None if unusable."""
    data = raw.get("data")
    if not data or len(data) < DAY0_SAMPLES:
        return None
    sl = data[: n_days * DAY0_SAMPLES]
    return {k: [clampint(d.get(f)) for d in sl] for k, f in RAW_FIELDS}


def day0(bands):
    """The day-0 slice (first 8 steps), carrying the rain list `r` when present."""
    keys = [k for k, _ in RAW_FIELDS] + (["r"] if "r" in bands else [])
    return {k: bands[k][:DAY0_SAMPLES] for k in keys}


def effective(b):
    # Per-step max of the three bands; intentionally simpler than the client's
    # display formula (format.ts).
    return [max(b["h"][i], b["m"][i], b["l"][i]) for i in range(len(b["h"]))]


def daily_means(b):
    means = {k: mean_round(b[k]) for k, _ in RAW_FIELDS}
    means["e"] = mean_round(effective(b))
    return means


def history_entry(b):
    return {**daily_means(b), "t": effective(b)}


def read_slices(store, date, codes):
    """{code: multi-day bands} for every readable raw file of date."""
    def read_one(code):
        raw = store.get_json(f"{date}/{code}-meteogram.json")
        return forecast_bands(raw) if raw is not None else None

    bands = pmap(read_one, codes)
    return {c: b for c, b in zip(codes, bands) if b is not None}


def list_dates(store):
    names = (p.rstrip("/") for p in store.list_prefixes(""))
    return sorted(n for n in names if DATE_ONLY_RE.match(n))


def codes_for_date(store, date):
    matches = (DATE_RE.match(k) for k in store.list_keys(f"{date}/"))
    return sorted(m.group(2) for m in matches if m and m.group(1) == date)


# Anchoring: the meteogram OCR gives an h/m/l split the MME numeric feed lacks;
# the MME gives a trustworthy total the OCR sometimes badly misses. Keep the
# split, pull the effective total halfway toward the MME when they disagree
# beyond TOL, and carry the MME's precip along as the rain channel.
BETA = 0.5
BETA_LOW_UP = 0.3  # low is the loudest band, so damp its share of an up-scale
TOL = 20
EFF_FLOOR = 10  # below this the OCR shows essentially clear...
TC_CLOUDY = 40  # ...and an MME total >= this means "inject missing cloud"
S_MAX_UP = 2.5  # cap upward multiplier: a thin band mustn't explode to overcast
RAIN_CLOUD_TRIGGER = 2.0  # only real rain (not drizzle) floors cloud
TC_RAIN_CLOUDY = 50  # and the MME total must agree there IS cloud
RAIN_CLOUD_FLOOR = 25  # keeps a faint low sprite (just clears COVER_FLOOR=20)


def _eff_at(bands, i):
    # Mirrors the client's altitude weighting (obs.ts): low counts full,
    # mid 0.8, high 0.45 — low cloud added under an existing mid/high sheet
    # doesn't change what the eye already reads as cloudy.
    return max(bands["l"][i], 0.8 * bands["m"][i], 0.45 * bands["h"][i])


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
            s = max(0.25, min(S_MAX_UP, t / eff))
            for k in ("h", "m", "l"):
                v = bands[k][i]
                # The MME total says nothing about altitude, so when it pushes
                # cover up, let mid/high absorb more of it than the low band.
                beta = BETA_LOW_UP if (k == "l" and s > 1) else BETA
                bands[k][i] = c100(v + beta * (min(100, v * s) - v))
        elif t >= TC_CLOUDY:
            # OCR says clear, ensemble says cloudy — the classic failure mode.
            # Middle is the least assertive band: "cloud, altitude unknown".
            bands["m"][i] = max(bands["m"][i], c100(BETA * t))
        else:
            continue
        n += 1
    return n


def apply_anchoring(slices, numeric):
    """Anchor every station in place against {date}/numeric.json (or None)."""
    if not numeric:
        return {"anchored": False}
    n = sum(anchor_bands(b, numeric["stations"][c]["tc"])
            for c, b in slices.items() if c in numeric["stations"])
    return {"anchored": True, "ic": numeric["ic"], "shift": numeric["shift"],
            "steps_anchored": n}


def attach_rain(slices, numeric):
    """Attach aligned MME precip as `r` (mm/3h). Where it genuinely rains and
    the MME agrees there is cloud, nudge the low band just past the render
    floor so streaks never fall from an empty sky."""
    if not numeric:
        return
    for code, bands in slices.items():
        num = numeric["stations"].get(code)
        if not num:
            continue
        n = len(bands["h"])
        r = [v or 0.0 for v in num["p"][:n]]
        bands["r"] = r + [0.0] * (n - len(r))
        tc = num["tc"]
        for i, v in enumerate(r):
            if v < RAIN_CLOUD_TRIGGER:
                continue
            t = tc[i] if i < len(tc) else None
            if t is None or t < TC_RAIN_CLOUDY:
                continue
            if _eff_at(bands, i) < RAIN_CLOUD_FLOOR:
                bands["l"][i] = RAIN_CLOUD_FLOOR


def load_histories(store, manifest_codes):
    codes = sorted(manifest_codes)
    return dict(zip(codes, pmap(lambda c: store.get_json(f"history/{c}.json"), codes)))


def cap_days(hist):
    if len(hist["days"]) > HISTORY_CAP:
        hist["days"] = dict(sorted(hist["days"].items())[-HISTORY_CAP:])


def put_histories(store, histories, codes):
    pmap(lambda c: store.put_json(f"history/{c}.json", histories[c], cache_control=SHORT),
         codes)


def update_histories(store, date, slices, manifest_codes, histories):
    """Merge today's daily means into histories and persist changed files.
    Idempotent by date key. Returns {code: daily_means}."""
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


SUN_THRESHOLD = 25    # effective daily mean < 25 => clear
CLOUD_THRESHOLD = 70  # effective daily mean >= 70 => cloudy

CITY_TIER_MAX = 2       # megacities..medium cities always in
CITY_POP_MIN = 100_000  # bigger towns of any tier make it too
TWIN_MIN_OVERLAP = 30   # shared reporting days before a correlation counts
TWIN_MIN_KM = 400       # hard floor; twins must be far apart
TWIN_R_FLOOR = 0.35     # min anomaly correlation to qualify at all
TWIN_R_SLACK = 0.05     # among far candidates near the best r, take the furthest
TWIN_WINDOW = 10        # ± days for each city's own rolling baseline
TWIN_MIN_STD = 5.0      # anomaly std below this = sky never changes; no alltime twin
TWIN_TODAY_MAX_RMSE = 12.0


def select_cities(manifest, manifest_codes):
    """Stations that stand in for a notable place: tier<=2 or district pop>=100k.
    Each IMD station IS the place, so there is no city->nearest-station join."""
    best = {}
    for code, s in manifest["stations"].items():
        if code not in manifest_codes:
            continue
        if s.get("canonical") is False:  # duplicate place; its twin represents it
            continue
        tier = s.get("tier")
        pop = s.get("pop") or 0
        if (tier is None or tier > CITY_TIER_MAX) and pop < CITY_POP_MIN:
            continue
        best[code] = s
    return best


def longest_run(dates, es, cond):
    """Longest run of consecutive calendar days matching cond; nulls break it."""
    best_len, best_start, best_end = 0, None, None
    run_len, run_start = 0, None
    for d, e in zip(dates, es):
        if e is not None and cond(e):
            if run_len == 0:
                run_start = d
            run_len += 1
            if run_len > best_len:
                best_len, best_start, best_end = run_len, run_start, d
        else:
            run_len = 0
    return {"len": best_len, "start": best_start, "end": best_end} if best_len else None


def pearson(xs, ys):
    n = len(xs)
    if n < 2:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    if sxx == 0 or syy == 0:
        return None
    return sxy / (sxx * syy) ** 0.5


def calendar_window(histories, cities, latest_date, history_cap):
    """Shared date range from earliest city record to latest_date, clamped to
    the history retention cap."""
    firsts = [min(days) for code in cities
              if (days := (histories.get(code) or {}).get("days", {}))]
    if not firsts:
        return None
    latest = datetime.date.fromisoformat(latest_date)
    start = max(datetime.date.fromisoformat(min(firsts)),
                latest - datetime.timedelta(days=history_cap - 1))
    return [(start + datetime.timedelta(days=i)).isoformat()
            for i in range((latest - start).days + 1)]


def city_entry(place, days, dates):
    es = [days[d]["e"] if d in days else None for d in dates]
    vals = [e for e in es if e is not None]
    if not vals:
        return None
    clear = sum(1 for e in vals if e < SUN_THRESHOLD)
    grey = sum(1 for e in vals if e >= CLOUD_THRESHOLD)
    return {
        "name": place["name"],
        "state": place.get("state"),
        "district": place.get("district"),
        "pop": place.get("pop"),
        "tier": place.get("tier"),
        "e": es,
        "mean": round(sum(vals) / len(vals), 1),
        "n": len(vals),
        "counts": {"clear": clear, "grey": grey, "mixed": len(vals) - clear - grey},
        "runs": {"clear": longest_run(dates, es, lambda e: e < SUN_THRESHOLD),
                 "grey": longest_run(dates, es, lambda e: e >= CLOUD_THRESHOLD)},
        "drought": longest_run(dates, es, lambda e: e >= SUN_THRESHOLD),
    }


def own_anomalies(es):
    # Deviation from each city's own rolling mean, not the national day mean —
    # avoids the "always-overcast hill town correlates with always-clear
    # desert" bug.
    n = len(es)
    out = [None] * n
    for i, e in enumerate(es):
        if e is None:
            continue
        lo, hi = max(0, i - TWIN_WINDOW), min(n, i + TWIN_WINDOW + 1)
        vals = [x for x in es[lo:hi] if x is not None]
        if len(vals) >= TWIN_WINDOW // 2:
            out[i] = e - sum(vals) / len(vals)
    return out


def std(vals):
    m = sum(vals) / len(vals)
    return (sum((v - m) ** 2 for v in vals) / len(vals)) ** 0.5


def rmse(xs, ys):
    return (sum((x - y) ** 2 for x, y in zip(xs, ys)) / len(xs)) ** 0.5


def assign_twins(entries, stations, profiles):
    """alltime twin = best anomaly-correlation over shared history (furthest
    wins on tie). today twin = city with the most similar 8-step effective
    profile (lowest RMSE). Writes twin: {today, alltime} per entry."""
    codes = sorted(entries)
    anom, eligible = {}, set()
    for c in codes:
        a = own_anomalies(entries[c]["e"])
        anom[c] = a
        vals = [x for x in a if x is not None]
        if len(vals) >= TWIN_MIN_OVERLAP and std(vals) >= TWIN_MIN_STD:
            eligible.add(c)

    hist_cands = {c: [] for c in codes}   # (other, r, km)
    today_cands = {c: [] for c in codes}  # (other, rmse, km)
    pair_r = {}                           # anomaly r per far pair, for tie-breaks
    for i, a in enumerate(codes):
        for b in codes[i + 1:]:
            sa, sb = stations[a], stations[b]
            km = haversine_km(sa["lat"], sa["lon"], sb["lat"], sb["lon"])
            if km < TWIN_MIN_KM:
                continue
            st_a, st_b = entries[a].get("state"), entries[b].get("state")
            if st_a and st_b and st_a == st_b:
                continue  # same state isn't a twin, however far

            if a in eligible and b in eligible:
                xy = [(x, y) for x, y in zip(anom[a], anom[b])
                      if x is not None and y is not None]
                if len(xy) >= TWIN_MIN_OVERLAP:
                    r = pearson([x for x, _ in xy], [y for _, y in xy])
                    if r is not None:
                        pair_r[a, b] = r
                        if r >= TWIN_R_FLOOR:
                            hist_cands[a].append((b, r, km))
                            hist_cands[b].append((a, r, km))

            pa, pb = profiles.get(a), profiles.get(b)
            if pa and pb and len(pa) == len(pb):
                d = rmse(pa, pb)
                if d <= TWIN_TODAY_MAX_RMSE:
                    today_cands[a].append((b, d, km))
                    today_cands[b].append((a, d, km))

    for code in codes:
        alltime = None
        if hist_cands[code]:
            cands = hist_cands[code]
            cutoff = max(r for _, r, _ in cands) - TWIN_R_SLACK
            other, r, km = max((s for s in cands if s[1] >= cutoff),
                               key=lambda s: (s[2], s[0]))
            alltime = {"code": other, "r": round(r, 2), "km": round(km)}

        today = None
        if today_cands[code]:
            def rank(s):
                other, d, km = s
                r = pair_r.get((min(code, other), max(code, other)), -1.0)
                return (d, -r, -km, other)  # closest sky; ties: higher r, further
            other, d, km = min(today_cands[code], key=rank)
            today = {"code": other, "rmse": round(d, 1), "km": round(km)}

        entries[code]["twin"] = {"today": today, "alltime": alltime}


def build_cities(histories, cities, latest_date, manifest, history_cap):
    """rollups/cities.json — per-city daily effective cover on a shared window
    plus the precomputed stats the explorer shows."""
    dates = calendar_window(histories, cities, latest_date, history_cap)
    if dates is None:
        return None

    entries, profiles = {}, {}
    for code, place in cities.items():
        days = (histories.get(code) or {}).get("days", {})
        entry = city_entry(place, days, dates)
        if entry:
            entries[code] = entry
            t = days.get(latest_date, {}).get("t")
            if t:
                profiles[code] = t

    # Rank 1 = cloudiest long-term mean; ties broken by code for stability.
    for rank, code in enumerate(sorted(entries, key=lambda c: (-entries[c]["mean"], c)), 1):
        entries[code]["rank"] = rank

    assign_twins(entries, manifest["stations"], profiles)

    def record(kind):
        withrun = [c for c in sorted(entries) if entries[c]["runs"][kind]]
        holder = max(withrun, key=lambda c: entries[c]["runs"][kind]["len"], default=None)
        return {"code": holder, **entries[holder]["runs"][kind]} if holder else None

    return {"generated": latest_date, "dates": dates,
            "records": {"clear": record("clear"), "grey": record("grey")},
            "cities": entries}
