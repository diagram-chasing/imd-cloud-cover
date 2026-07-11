"""Aggregate day-0 cloud slices into the frontend's static JSON views.

Reads the per-station raw meteogram JSONs (written by main.py to
`{date}/{CODE}-meteogram.json`) and produces the derived views the frontend
consumes:

  meta/stations.json        station manifest (copied from repo)
  meta/dates.json           { dates: [...], latest: "YYYY-MM-DD" }
  latest/all-stations.json  today's 8-step day-0 slice per station
  latest/summary.json       national means, cloudiest/clearest
  history/{CODE}.json       per-day daily means (h,m,l,e) plus the 8-step
                            effective series `t`, capped at 400 days
  rollups/7d.json,30d.json  per-station daily-mean series over the window
  rollups/cities.json       long-term city explorer view
  reports/{date}.json       run report

"Observed" = the day-0 slice = first 8 of each 10-day forecast (00:00..21:00 IST).
Effective cover `e` = mean over steps of max(h, m, l).

Idempotent: running twice for the same date yields identical output. `--rebuild`
re-reads every dated raw file in the store and regenerates all derived views.
"""

import argparse
import datetime
import json
import math
import os
import re
from concurrent.futures import ThreadPoolExecutor

from dotenv import load_dotenv

from storage import get_store, SHORT

load_dotenv()

STEPS = ["00:00", "03:00", "06:00", "09:00", "12:00", "15:00", "18:00", "21:00"]
DAY0_SAMPLES = 8
# Days of forecast to expose in latest/all-stations.json: day-0 plus the next
# (FORECAST_DAYS-1). The client shows the visitor's *current* IST day out of
# this window, so the site reads as "today" even before the day's scrape runs.
FORECAST_DAYS = 3
HISTORY_CAP = 400

# One key per band; RAW_FIELDS maps view keys to raw-JSON field names.
BANDS = ("h", "m", "l", "e")
RAW_FIELDS = (("h", "high"), ("m", "middle"), ("l", "low"))

DATE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})/([A-Za-z0-9_-]+)-meteogram\.json$")
DATE_ONLY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# The store's per-object ops are network round-trips; run them concurrently.
# boto3 clients are thread-safe for distinct calls (main.py already relies on this).
MAX_WORKERS = 16

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


# --------------------------------------------------------------------------
# Shared helpers
# --------------------------------------------------------------------------

def pmap(fn, items):
    """Map `fn` over `items` concurrently, preserving order. Empty-safe."""
    items = list(items)
    if not items:
        return []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        return list(ex.map(fn, items))


def here(*parts):
    return os.path.join(os.path.dirname(__file__), *parts)


def load_manifest():
    with open(here("stations.json")) as f:
        return json.load(f)


def clampint(v):
    try:
        return max(0, min(100, round(float(v))))
    except (TypeError, ValueError):
        return 0


def mean_round(vals):
    return round(sum(vals) / len(vals))


# --------------------------------------------------------------------------
# Raw slices
# --------------------------------------------------------------------------

def forecast_bands(raw, n_days=FORECAST_DAYS):
    """{"h","m","l": up to n_days*8 ints each}, or None if unusable.

    Reads the leading `n_days` of the 3-hourly forecast (the raw meteogram holds
    ~10). A short forecast simply yields fewer steps; callers slice day-0 off the
    front with `day0()`.
    """
    data = raw.get("data")
    if not data or len(data) < DAY0_SAMPLES:
        return None
    sl = data[: n_days * DAY0_SAMPLES]
    return {k: [clampint(d.get(f)) for d in sl] for k, f in RAW_FIELDS}


def day0(bands):
    """The day-0 slice (first 8 steps) of a possibly multi-day bands dict."""
    return {k: bands[k][:DAY0_SAMPLES] for k, _ in RAW_FIELDS}


def effective(b):
    """Per-step effective cover: max of the three cloud bands."""
    return [max(b["h"][i], b["m"][i], b["l"][i]) for i in range(len(b["h"]))]


def daily_means(b):
    """Per-band daily means plus effective mean `e` (mean of per-step max)."""
    means = {k: mean_round(b[k]) for k, _ in RAW_FIELDS}
    means["e"] = mean_round(effective(b))
    return means


def history_entry(b):
    """A station-history day: daily means plus `t`, the 8-step effective series.

    `t` feeds the station page's time-of-day facts; rollups only read the means.
    """
    return {**daily_means(b), "t": effective(b)}


def read_slice(store, date, code):
    raw = store.get_json(f"{date}/{code}-meteogram.json")
    return forecast_bands(raw) if raw is not None else None


def read_slices(store, date, codes):
    """{code: multi-day bands} for every readable raw file of `date`, fetched
    concurrently. Values span up to FORECAST_DAYS; slice day-0 with `day0()`."""
    bands = pmap(lambda c: read_slice(store, date, c), codes)
    return {c: b for c, b in zip(codes, bands) if b is not None}


def list_dates(store):
    """All snapshot dates, sorted ascending (one cheap delimited listing)."""
    names = (p.rstrip("/") for p in store.list_prefixes(""))
    return sorted(n for n in names if DATE_ONLY_RE.match(n))


def codes_for_date(store, date):
    matches = (DATE_RE.match(k) for k in store.list_keys(f"{date}/"))
    return sorted(m.group(2) for m in matches if m and m.group(1) == date)


# --------------------------------------------------------------------------
# Histories
# --------------------------------------------------------------------------

def load_histories(store, manifest_codes):
    """{code: hist-or-None}, fetched once, concurrently. All downstream views
    read from this single in-memory copy."""
    codes = sorted(manifest_codes)
    return dict(zip(codes, pmap(lambda c: store.get_json(f"history/{c}.json"), codes)))


def cap_days(hist):
    if len(hist["days"]) > HISTORY_CAP:
        hist["days"] = dict(sorted(hist["days"].items())[-HISTORY_CAP:])


def put_histories(store, histories, codes):
    pmap(lambda c: store.put_json(f"history/{c}.json", histories[c], cache_control=SHORT),
         codes)


def update_histories(store, date, slices, manifest_codes, histories):
    """Merge today's daily means into the in-memory histories, persist the
    changed files. Mutates `histories` so downstream views see today's data.
    Idempotent by date key. Returns {code: daily_means}.
    """
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


# --------------------------------------------------------------------------
# View builders
# --------------------------------------------------------------------------

def build_latest(date, generated_at, manifest_codes, slices):
    """latest/all-stations.json — the day-0 slice per mapped station, plus a
    short multi-day forecast tail.

    `date`/`stations` are day-0 (8 steps), exactly as before. `fdays`/`forecast`
    carry the next few calendar days (day-major, 8 steps each) so the client can
    render the visitor's *current* IST day even before that day's scrape runs.
    Both are omitted when no station has a usable tail (old single-day raws).
    """
    mapped = {c: b for c, b in slices.items() if c in manifest_codes}
    stations = {c: day0(b) for c, b in mapped.items()}

    # Every raw forecast starts at the same midnight, so one shared fdays list
    # covers all stations. n_future is bounded by FORECAST_DAYS and by the data
    # actually present.
    max_steps = max((len(b["h"]) for b in mapped.values()), default=DAY0_SAMPLES)
    n_future = min(FORECAST_DAYS - 1, max_steps // DAY0_SAMPLES - 1)
    d0 = datetime.date.fromisoformat(date)
    fdays = [(d0 + datetime.timedelta(days=i + 1)).isoformat() for i in range(n_future)]

    forecast = {}
    if fdays:
        want = (n_future + 1) * DAY0_SAMPLES
        for c, b in mapped.items():
            tail = {k: b[k][DAY0_SAMPLES:want] for k, _ in RAW_FIELDS}
            # Keep only stations covering every future day fully, so the client's
            # day-major indexing never lands on a short array.
            if len(tail["h"]) == n_future * DAY0_SAMPLES:
                forecast[c] = tail

    out = {"date": date, "generated_at": generated_at, "steps": STEPS,
           "stations": stations}
    if fdays and forecast:
        out["fdays"] = fdays
        out["forecast"] = forecast
    return out


def build_rollups(histories, dates_window, manifest_codes):
    """Per-station daily-mean series over an ascending date window.
    Missing days are null-filled; national means ignore nulls."""
    stations = {}
    for code in sorted(manifest_codes):
        days = (histories.get(code) or {}).get("days", {})
        rows = [days.get(d) for d in dates_window]
        if any(rows):
            stations[code] = {b: [dm.get(b) if dm else None for dm in rows]
                              for b in BANDS}
    national = {}
    for b in BANDS:
        national[b] = []
        for i in range(len(dates_window)):
            vals = [s[b][i] for s in stations.values() if s[b][i] is not None]
            national[b].append(mean_round(vals) if vals else None)
    return {"window": len(dates_window), "dates": dates_window,
            "stations": stations, "national": national}


# --------------------------------------------------------------------------
# Cities view (the homepage's long-term city explorer)
# --------------------------------------------------------------------------

def load_places():
    """The frontend's place gazetteer (city -> nearest station), or None if
    absent. Missing/corrupt file skips the cities view rather than failing."""
    try:
        with open(here("..", "static", "data", "india-places.json")) as f:
            return json.load(f)["features"]
    except (OSError, ValueError, KeyError) as e:
        print(f"cities: could not read india-places.json ({e}); skipping cities view")
        return None


def select_cities(features, manifest_codes):
    """Cities (tier<=2 or pop>=100k) with a mapped station, deduped to the
    biggest city per station (a city's series IS its station's history).
    Returns {station code: place properties}."""
    best = {}
    for feat in features:
        p = feat.get("properties", {})
        code = p.get("nearest")
        if code not in manifest_codes:
            continue
        if p.get("tier", 9) > CITY_TIER_MAX and (p.get("pop") or 0) < CITY_POP_MIN:
            continue
        if code not in best or (p.get("pop") or 0) > (best[code].get("pop") or 0):
            best[code] = p
    return best


def haversine_km(lat1, lon1, lat2, lon2):
    rlat1, rlat2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin((rlat2 - rlat1) / 2) ** 2
         + math.cos(rlat1) * math.cos(rlat2)
         * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 6371 * 2 * math.asin(math.sqrt(a))


def longest_run(dates, es, cond):
    """Longest run of consecutive calendar days matching cond; nulls break it.
    Returns {"len","start","end"} or None if no day matches."""
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


def calendar_window(histories, cities, latest_date):
    """Shared calendar window: earliest recorded day across the selected
    cities up to latest_date, capped like the histories are."""
    firsts = [min(days) for code in cities
              if (days := (histories.get(code) or {}).get("days", {}))]
    if not firsts:
        return None
    latest = datetime.date.fromisoformat(latest_date)
    start = max(datetime.date.fromisoformat(min(firsts)),
                latest - datetime.timedelta(days=HISTORY_CAP - 1))
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
    """Deviation from the city's OWN centered rolling mean (null-aware).

    Anomalies vs the national day-mean backfire for low-variance cities: an
    always-overcast hill town and an always-clear desert both reduce to
    (constant - day_mean), and those correlate perfectly — the exact
    "cloudiest twinned with clearest" bug. Deseasonalising each series
    against itself measures real day-to-day co-fluctuation instead.
    """
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
    """Two twins per city, both far away (>= TWIN_MIN_KM, different state):

      alltime — best own-climatology anomaly correlation over the shared
                history; among candidates within TWIN_R_SLACK of the best r,
                the furthest wins. Flat-sky cities (anomaly std < TWIN_MIN_STD)
                sit this one out — nothing to co-fluctuate.
      today   — the city whose 8-step effective profile for the latest day is
                closest (lowest RMSE), ties broken by higher historical r,
                then distance. Daily mean `e` is too coarse (dozens of cities
                share e=80); the shape of the day is what distinguishes.
                Flat-sky cities DO participate here: sharing today's overcast
                is legitimate even if your sky never varies.

    Ships as twin: {"today": {code, rmse, km} | null,
                    "alltime": {code, r, km} | null}.
    """
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


def build_cities(histories, cities, latest_date, manifest):
    """rollups/cities.json — per-city daily effective cover on a shared window
    plus the precomputed stats the explorer shows."""
    dates = calendar_window(histories, cities, latest_date)
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


# --------------------------------------------------------------------------
# Summary / indexes
# --------------------------------------------------------------------------

NATIONAL_KEYS = (("h", "h"), ("m", "m"), ("l", "l"), ("total", "e"))


def build_summary(date, manifest, today_means, failed_count):
    codes = list(today_means)
    names = manifest["stations"]

    def extreme(agg, key):
        code = agg(codes, key=lambda c: today_means[c].get(key, 0))
        return {"code": code, "name": names.get(code, {}).get("name", code),
                "value": today_means[code].get(key, 0)}

    if codes:
        nat = {out: mean_round([today_means[c].get(src, 0) for c in codes])
               for out, src in NATIONAL_KEYS}
        cloudiest, clearest = extreme(max, "e"), extreme(min, "e")
    else:
        nat = {out: 0 for out, _ in NATIONAL_KEYS}
        cloudiest = clearest = None

    return {"date": date, "national_mean": nat, "cloudiest": cloudiest,
            "clearest": clearest,
            "station_count": len(codes), "failed_count": failed_count}


def update_dates_index(store, latest_date, dates=None):
    if dates is None:
        dates = list_dates(store)
    doc = {"dates": dates, "latest": dates[-1] if dates else latest_date}
    store.put_json("meta/dates.json", doc, cache_control=SHORT)
    return doc


def upload_manifest(store):
    manifest = load_manifest()
    store.put_json("meta/stations.json", manifest, cache_control=SHORT)
    return manifest


def window_dates(latest_date, n):
    """The n calendar days ending at latest_date (ascending, inclusive)."""
    latest = datetime.date.fromisoformat(latest_date)
    return [(latest - datetime.timedelta(days=i)).isoformat()
            for i in range(n - 1, -1, -1)]


# --------------------------------------------------------------------------
# Orchestration
# --------------------------------------------------------------------------

def aggregate_date(store, date, generated_at, report=None):
    """Build all derived views treating `date` as the latest snapshot."""
    manifest = upload_manifest(store)
    manifest_codes = set(manifest["stations"])

    codes = codes_for_date(store, date)
    print(f"Reading {len(codes)} raw slices for {date}...")
    slices = read_slices(store, date, codes)
    unmapped = sorted(c for c in slices if c not in manifest_codes)

    store.put_json("latest/all-stations.json",
                   build_latest(date, generated_at, manifest_codes, slices),
                   cache_control=SHORT)

    print(f"Loading {len(manifest_codes)} station histories...")
    histories = load_histories(store, manifest_codes)
    today_means = update_histories(store, date, slices, manifest_codes, histories)

    print("Building rollups and summary...")
    for n, name in ((7, "7d"), (30, "30d")):
        roll = build_rollups(histories, window_dates(date, n), manifest_codes)
        store.put_json(f"rollups/{name}.json", roll, cache_control=SHORT)

    places = load_places()
    if places is not None:
        doc = build_cities(histories, select_cities(places, manifest_codes), date, manifest)
        if doc:
            store.put_json("rollups/cities.json", doc, cache_control=SHORT)
            print(f"Wrote cities view: {len(doc['cities'])} cities, "
                  f"{len(doc['dates'])} days.")

    failed_count = report.get("failed_count", 0) if report else 0
    summary = build_summary(date, manifest, today_means, failed_count)
    store.put_json("latest/summary.json", summary, cache_control=SHORT)

    update_dates_index(store, date, list_dates(store))

    run_report = {
        "date": date,
        "generated_at": generated_at,
        "succeeded": sorted(slices),
        "succeeded_count": len(slices),
        "mapped_count": len(today_means),
        "unmapped": unmapped,
        "failed": report.get("failed", []) if report else [],
        "suspicious": report.get("suspicious", []) if report else [],
        "discovered": report.get("discovered") if report else len(codes),
    }
    store.put_json(f"reports/{date}.json", run_report, cache_control=SHORT)
    return run_report


def cities_only(store, date=None):
    """Build just rollups/cities.json from the histories already in the store."""
    manifest = load_manifest()
    manifest_codes = set(manifest["stations"])
    places = load_places()
    if places is None:
        return
    if date is None:
        idx = store.get_json("meta/dates.json")
        date = (idx or {}).get("latest") or datetime.date.today().isoformat()
    print(f"Loading {len(manifest_codes)} station histories...")
    histories = load_histories(store, manifest_codes)
    doc = build_cities(histories, select_cities(places, manifest_codes), date, manifest)
    if doc:
        store.put_json("rollups/cities.json", doc, cache_control=SHORT)
        print(f"Wrote cities view: {len(doc['cities'])} cities, {len(doc['dates'])} days.")


def rebuild(store, generated_at):
    """Re-read every dated raw file and regenerate all histories + views."""
    all_dates = list_dates(store)
    if not all_dates:
        print("No dated files found to rebuild from.")
        return
    print(f"Rebuilding histories from {len(all_dates)} dates: "
          f"{all_dates[0]}..{all_dates[-1]}")

    manifest = upload_manifest(store)
    manifest_codes = set(manifest["stations"])

    # Reads within a date run concurrently; dates stay ordered so each
    # history's `days` keys insert chronologically.
    histories = {}
    for date in all_dates:
        codes = [c for c in codes_for_date(store, date) if c in manifest_codes]
        for code, b in read_slices(store, date, codes).items():
            hist = histories.setdefault(code, {"code": code, "kind": "day0-forecast",
                                               "days": {}})
            hist["days"][date] = history_entry(day0(b))

    for hist in histories.values():
        cap_days(hist)
    put_histories(store, histories, list(histories))
    print(f"Wrote {len(histories)} history files.")

    latest_date = all_dates[-1]
    report = aggregate_date(store, latest_date, generated_at)
    print(f"Rebuilt views for latest date {latest_date}: "
          f"{report['mapped_count']} mapped stations.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="snapshot date (YYYY-MM-DD); default today")
    ap.add_argument("--results", help="run-results JSON from main.py (failures/discovered)")
    ap.add_argument("--generated-at", help="ISO timestamp for generated_at; default now")
    ap.add_argument("--rebuild", action="store_true",
                    help="rebuild everything from all dated files")
    ap.add_argument("--cities-only", action="store_true",
                    help="build just rollups/cities.json from existing histories")
    args = ap.parse_args()

    store = get_store()
    generated_at = args.generated_at or datetime.datetime.now(datetime.timezone.utc).isoformat()

    if args.rebuild:
        return rebuild(store, generated_at)
    if args.cities_only:
        return cities_only(store, args.date)

    report, date = None, args.date
    if args.results:
        with open(args.results) as f:
            report = json.load(f)
        date = date or report.get("date")
    date = date or datetime.date.today().isoformat()

    run_report = aggregate_date(store, date, generated_at, report)
    print(f"Aggregated {date}: {run_report['mapped_count']} mapped / "
          f"{run_report['succeeded_count']} succeeded, "
          f"{len(run_report['unmapped'])} unmapped, "
          f"{len(run_report['failed'])} failed.")


if __name__ == "__main__":
    main()