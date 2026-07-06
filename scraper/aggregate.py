"""Aggregate day-0 cloud slices into the frontend's static JSON views.

Reads the per-station raw meteogram JSONs (written by main.py to
`{date}/{CODE}-meteogram.json`) and produces the derived views the frontend
consumes:

  meta/stations.json      the station manifest (copied from repo)
  meta/dates.json         { dates: [...], latest: "YYYY-MM-DD" }
  latest/all-stations.json  today's 8-step day-0 slice per station
  latest/summary.json     national means, cloudiest/clearest, streaks
  history/{CODE}.json     per-day daily means (h,m,l,e), capped at 400 days
  rollups/7d.json,30d.json  per-station daily-mean series over the window
  reports/{date}.json     run report (succeeded/failed/suspicious/unmapped)

"Observed" = the day-0 slice = first 8 of each 10-day forecast (00:00..21:00 IST).
Effective cover `e` = mean over steps of max(h, m, l).

Idempotent: running twice for the same date yields identical output. `--rebuild`
re-reads every dated raw file in the store and regenerates all derived views.
"""

import argparse
import datetime
import json
import os
import re

from storage import get_store, SHORT

STEPS = ["00:00", "03:00", "06:00", "09:00", "12:00", "15:00", "18:00", "21:00"]
DAY0_SAMPLES = 8
HISTORY_CAP = 400
DATE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})/([A-Za-z0-9_-]+)-meteogram\.json$")

SUN_THRESHOLD = 25   # effective daily mean < 25 => clear
CLOUD_THRESHOLD = 70  # effective daily mean >= 70 => cloudy


def manifest_path():
    return os.path.join(os.path.dirname(__file__), "stations.json")


def load_manifest():
    with open(manifest_path()) as f:
        return json.load(f)


def clampint(v):
    try:
        return max(0, min(100, round(float(v))))
    except (TypeError, ValueError):
        return 0


def day0_bands(raw):
    """Return (h, m, l) each a list of 8 ints, or None if the raw JSON is unusable."""
    data = raw.get("data")
    if not data or len(data) < DAY0_SAMPLES:
        return None
    sl = data[:DAY0_SAMPLES]
    h = [clampint(d.get("high")) for d in sl]
    m = [clampint(d.get("middle")) for d in sl]
    l = [clampint(d.get("low")) for d in sl]
    return h, m, l


def daily_means(h, m, l):
    """Per-band daily means plus effective mean (mean of per-step max)."""
    n = len(h)
    hm = round(sum(h) / n)
    mm = round(sum(m) / n)
    lm = round(sum(l) / n)
    em = round(sum(max(h[i], m[i], l[i]) for i in range(n)) / n)
    return {"h": hm, "m": mm, "l": lm, "e": em}


# --------------------------------------------------------------------------
# Reading raw slices
# --------------------------------------------------------------------------

def read_slice(store, date, code):
    raw = store.get_json(f"{date}/{code}-meteogram.json")
    if raw is None:
        return None
    return day0_bands(raw)


def list_dates(store):
    """All dates that have at least one dated meteogram JSON, sorted ascending."""
    dates = set()
    for key in store.list_keys(""):
        m = DATE_RE.match(key)
        if m:
            dates.add(m.group(1))
    return sorted(dates)


def codes_for_date(store, date):
    codes = []
    for key in store.list_keys(f"{date}/"):
        m = DATE_RE.match(key)
        if m and m.group(1) == date:
            codes.append(m.group(2))
    return sorted(codes)


# --------------------------------------------------------------------------
# View builders
# --------------------------------------------------------------------------

def build_latest(store, date, manifest_codes, slices):
    """latest/all-stations.json — today's 8-step day-0 slice per mapped station."""
    stations = {}
    for code, bands in slices.items():
        if code not in manifest_codes:
            continue
        h, m, l = bands
        stations[code] = {"h": h, "m": m, "l": l}
    doc = {
        "date": date,
        "generated_at": None,  # stamped by caller (Date unavailable in some contexts)
        "steps": STEPS,
        "stations": stations,
    }
    return doc


def update_histories(store, date, slices, manifest_codes):
    """Merge today's daily means into each mapped station's history file.

    Idempotent by date key. Returns {code: daily_means} for today.
    """
    today_means = {}
    for code, bands in slices.items():
        if code not in manifest_codes:
            continue
        h, m, l = bands
        dm = daily_means(h, m, l)
        today_means[code] = dm

        key = f"history/{code}.json"
        hist = store.get_json(key) or {"code": code, "kind": "day0-forecast", "days": {}}
        hist.setdefault("days", {})
        hist["days"][date] = dm
        # Cap to most recent HISTORY_CAP dates.
        if len(hist["days"]) > HISTORY_CAP:
            keep = dict(sorted(hist["days"].items())[-HISTORY_CAP:])
            hist["days"] = keep
        store.put_json(key, hist, cache_control=SHORT)
    return today_means


def build_rollups(store, dates_window, manifest_codes):
    """Per-station daily-mean series over a date window, from history files.

    dates_window is ascending list of dates. Missing days are null-filled.
    """
    stations = {}
    national = {"h": [], "m": [], "l": [], "e": []}
    # Gather per-station series
    for code in manifest_codes:
        hist = store.get_json(f"history/{code}.json")
        if not hist:
            continue
        days = hist.get("days", {})
        series = {"h": [], "m": [], "l": [], "e": []}
        present = False
        for d in dates_window:
            dm = days.get(d)
            for band in ("h", "m", "l", "e"):
                series[band].append(dm[band] if dm else None)
            if dm:
                present = True
        if present:
            stations[code] = series
    # National per-day means (ignoring nulls)
    for i, _d in enumerate(dates_window):
        for band in ("h", "m", "l", "e"):
            vals = [s[band][i] for s in stations.values() if s[band][i] is not None]
            national[band].append(round(sum(vals) / len(vals)) if vals else None)
    return {"window": len(dates_window), "dates": dates_window, "stations": stations, "national": national}


def compute_streaks(store, latest_date, manifest_codes, manifest):
    """Current active streaks per station, walking back calendar-consecutively.

    Returns {"sun": [{code,name,days}], "cloud": [...]} top-5 each.
    """
    sun, cloud = [], []
    latest = datetime.date.fromisoformat(latest_date)
    for code in manifest_codes:
        hist = store.get_json(f"history/{code}.json")
        if not hist:
            continue
        days = hist.get("days", {})
        name = manifest["stations"].get(code, {}).get("name", code)

        def run_length(cond):
            n = 0
            d = latest
            while True:
                key = d.isoformat()
                dm = days.get(key)
                if dm is None or not cond(dm["e"]):
                    break
                n += 1
                d -= datetime.timedelta(days=1)
            return n

        s = run_length(lambda e: e < SUN_THRESHOLD)
        c = run_length(lambda e: e >= CLOUD_THRESHOLD)
        if s > 0:
            sun.append({"code": code, "name": name, "days": s})
        if c > 0:
            cloud.append({"code": code, "name": name, "days": c})

    sun.sort(key=lambda x: (-x["days"], x["code"]))
    cloud.sort(key=lambda x: (-x["days"], x["code"]))
    return {"sun": sun[:5], "cloud": cloud[:5]}


def build_summary(store, date, manifest, today_means, streaks, failed_count):
    codes = list(today_means.keys())
    if codes:
        nat = {
            "h": round(sum(today_means[c]["h"] for c in codes) / len(codes)),
            "m": round(sum(today_means[c]["m"] for c in codes) / len(codes)),
            "l": round(sum(today_means[c]["l"] for c in codes) / len(codes)),
            "total": round(sum(today_means[c]["e"] for c in codes) / len(codes)),
        }
        cloudiest_code = max(codes, key=lambda c: today_means[c]["e"])
        clearest_code = min(codes, key=lambda c: today_means[c]["e"])
        names = manifest["stations"]
        cloudiest = {"code": cloudiest_code, "name": names.get(cloudiest_code, {}).get("name", cloudiest_code),
                     "value": today_means[cloudiest_code]["e"]}
        clearest = {"code": clearest_code, "name": names.get(clearest_code, {}).get("name", clearest_code),
                    "value": today_means[clearest_code]["e"]}
    else:
        nat = {"h": 0, "m": 0, "l": 0, "total": 0}
        cloudiest = clearest = None

    return {
        "date": date,
        "national_mean": nat,
        "cloudiest": cloudiest,
        "clearest": clearest,
        "streaks": streaks,
        "station_count": len(codes),
        "failed_count": failed_count,
    }


def update_dates_index(store, latest_date):
    dates = list_dates(store)
    doc = {"dates": dates, "latest": dates[-1] if dates else latest_date}
    store.put_json("meta/dates.json", doc, cache_control=SHORT)
    return doc


def upload_manifest(store):
    manifest = load_manifest()
    store.put_json("meta/stations.json", manifest, cache_control=SHORT)
    return manifest


def window_dates(all_dates, latest_date, n):
    """The n calendar days ending at latest_date (ascending, inclusive)."""
    latest = datetime.date.fromisoformat(latest_date)
    return [(latest - datetime.timedelta(days=i)).isoformat() for i in range(n - 1, -1, -1)]


# --------------------------------------------------------------------------
# Orchestration
# --------------------------------------------------------------------------

def aggregate_date(store, date, generated_at, report=None):
    """Build all derived views treating `date` as the latest snapshot."""
    manifest = upload_manifest(store)
    manifest_codes = set(manifest["stations"].keys())

    codes = codes_for_date(store, date)
    slices = {}
    suspicious = []
    for code in codes:
        bands = read_slice(store, date, code)
        if bands is None:
            continue
        slices[code] = bands

    unmapped = sorted(c for c in slices if c not in manifest_codes)

    latest = build_latest(store, date, manifest_codes, slices)
    latest["generated_at"] = generated_at
    store.put_json("latest/all-stations.json", latest, cache_control=SHORT)

    today_means = update_histories(store, date, slices, manifest_codes)

    all_dates = list_dates(store)
    for n, name in ((7, "7d"), (30, "30d")):
        win = window_dates(all_dates, date, n)
        roll = build_rollups(store, win, manifest_codes)
        store.put_json(f"rollups/{name}.json", roll, cache_control=SHORT)

    streaks = compute_streaks(store, date, manifest_codes, manifest)
    failed_count = report.get("failed_count", 0) if report else 0
    summary = build_summary(store, date, manifest, today_means, streaks, failed_count)
    store.put_json("latest/summary.json", summary, cache_control=SHORT)

    update_dates_index(store, date)

    run_report = {
        "date": date,
        "generated_at": generated_at,
        "succeeded": sorted(slices.keys()),
        "succeeded_count": len(slices),
        "mapped_count": len(today_means),
        "unmapped": unmapped,
        "failed": report.get("failed", []) if report else [],
        "suspicious": (report.get("suspicious", []) if report else []) + suspicious,
        "discovered": report.get("discovered") if report else len(codes),
    }
    store.put_json(f"reports/{date}.json", run_report, cache_control=SHORT)
    return run_report


def rebuild(store, generated_at):
    """Re-read every dated raw file and regenerate all histories + views."""
    all_dates = list_dates(store)
    if not all_dates:
        print("No dated files found to rebuild from.")
        return
    print(f"Rebuilding histories from {len(all_dates)} dates: {all_dates[0]}..{all_dates[-1]}")

    manifest = upload_manifest(store)
    manifest_codes = set(manifest["stations"].keys())

    # Rebuild histories from scratch in date order.
    fresh_hist = {}
    for date in all_dates:
        for code in codes_for_date(store, date):
            if code not in manifest_codes:
                continue
            bands = read_slice(store, date, code)
            if bands is None:
                continue
            h, m, l = bands
            fresh_hist.setdefault(code, {"code": code, "kind": "day0-forecast", "days": {}})
            fresh_hist[code]["days"][date] = daily_means(h, m, l)

    for code, hist in fresh_hist.items():
        if len(hist["days"]) > HISTORY_CAP:
            hist["days"] = dict(sorted(hist["days"].items())[-HISTORY_CAP:])
        store.put_json(f"history/{code}.json", hist, cache_control=SHORT)
    print(f"Wrote {len(fresh_hist)} history files.")

    # Regenerate latest/rollups/summary for the most recent date.
    latest_date = all_dates[-1]
    report = aggregate_date(store, latest_date, generated_at)
    print(f"Rebuilt views for latest date {latest_date}: "
          f"{report['mapped_count']} mapped stations.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="snapshot date (YYYY-MM-DD); default today")
    ap.add_argument("--results", help="run-results JSON from main.py (failures/discovered)")
    ap.add_argument("--generated-at", help="ISO timestamp for generated_at; default now")
    ap.add_argument("--rebuild", action="store_true", help="rebuild everything from all dated files")
    args = ap.parse_args()

    store = get_store()
    generated_at = args.generated_at or datetime.datetime.now(datetime.timezone.utc).isoformat()

    if args.rebuild:
        rebuild(store, generated_at)
        return

    report = None
    date = args.date
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
