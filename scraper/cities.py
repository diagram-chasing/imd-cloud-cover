"""The homepage's long-term city explorer view (rollups/cities.json).

Selects the stations that stand in for notable places, computes per-city
daily-effective-cover stats over a shared calendar window, and assigns each
city its "sky twins": the far-away city with the most correlated anomaly
history (alltime) and the one with today's most similar 8-step profile.
"""

import datetime

from common import haversine_km

SUN_THRESHOLD = 25    # effective daily mean < 25 => clear
CLOUD_THRESHOLD = 70  # effective daily mean >= 70 => cloudy

CITY_TIER_MAX = 2       # megacities..medium cities always in
CITY_POP_MIN = 100_000  # bigger towns of any tier make it too
TWIN_MIN_OVERLAP = 30   # shared reporting days before a correlation counts
TWIN_MIN_KM = 400       # hard floor; twins must be far apart
TWIN_R_FLOOR = 0.35     # min ANOMALY correlation to qualify at all
TWIN_R_SLACK = 0.05     # among far candidates near the best r, take the FURTHEST
TWIN_WINDOW = 10        # ± days for each city's own rolling baseline
TWIN_MIN_STD = 5.0      # anomaly std below this = sky never changes; no alltime twin
TWIN_TODAY_MAX_RMSE = 12.0  # today's 8-step profiles must be at least this close


def select_cities(manifest, manifest_codes):
    """Stations that stand in for a notable place: tier<=2 or district pop>=100k.

    Each IMD station IS the place (real name + district + state + its own coords),
    so there is no city->nearest-station join and no spurious far matches. Returns
    {code: station_entry}."""
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
    """longest run of consecutive calendar days matching cond; nulls break it."""
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
    """shared date range from earliest city record to latest_date, clamped to
    the caller's history retention cap."""
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
    """deviation from each city's own rolling mean (not the national day mean).
    avoids the "always-overcast hill town correlates with always-clear desert" bug."""
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
    """alltime twin = best anomaly-correlation over shared history (furthest wins on tie).
    today twin = city with most similar 8-step effective profile (lowest RMSE).
    writes twin: {"today": {code, rmse, km}|null, "alltime": {code, r, km}|null} per entry."""
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

            # All-time: anomaly correlation between variance-eligible cities.
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

            # Today: profile distance, when both cities reported today.
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
                profiles[code] = t  # today's 8-step effective profile

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
