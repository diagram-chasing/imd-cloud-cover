"""Aggregate day-0 meteogram slices into the frontend's static JSON views.

Outputs: meta/stations.json, meta/dates.json, latest/all-stations.json,
latest/summary.json, history/{CODE}.json, rollups/{7d,30d,cities}.json,
reports/{date}.json. Idempotent; --rebuild regenerates all views from stored raws.
"""

import argparse
import datetime
import json

from dotenv import load_dotenv

from anchor import apply_anchoring, attach_rain
from bands import (BANDS, DAY0_SAMPLES, FORECAST_DAYS, RAW_FIELDS, STEPS,
                   codes_for_date, day0, history_entry, list_dates, mean_round,
                   read_slices)
from cities import build_cities, select_cities
from common import load_manifest
from histories import HISTORY_CAP, cap_days, load_histories, put_histories, update_histories
from storage import SHORT, get_store

load_dotenv()


# --------------------------------------------------------------------------
# View builders
# --------------------------------------------------------------------------

def build_latest(date, generated_at, manifest_codes, slices):
    """latest/all-stations.json: day-0 slice per station plus multi-day forecast tail."""
    mapped = {c: b for c, b in slices.items() if c in manifest_codes}
    stations = {c: day0(b) for c, b in mapped.items()}

    # one shared fdays list covers all stations; n_future bounded by data present
    max_steps = max((len(b["h"]) for b in mapped.values()), default=DAY0_SAMPLES)
    n_future = min(FORECAST_DAYS - 1, max_steps // DAY0_SAMPLES - 1)
    d0 = datetime.date.fromisoformat(date)
    fdays = [(d0 + datetime.timedelta(days=i + 1)).isoformat() for i in range(n_future)]

    forecast = {}
    if fdays:
        want = (n_future + 1) * DAY0_SAMPLES
        for c, b in mapped.items():
            tail = {k: b[k][DAY0_SAMPLES:want] for k, _ in RAW_FIELDS}
            if "r" in b:
                tail["r"] = b["r"][DAY0_SAMPLES:want]
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
    """per-station daily-mean series over dates_window; null-fill missing days."""
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

    # Anchor OCR bands against the MME numeric sidecar (when the day has one)
    # BEFORE any view is built, so latest/histories/rollups agree.
    numeric = store.get_json(f"{date}/numeric.json")
    anchor_report = apply_anchoring(slices, numeric)
    attach_rain(slices, numeric)
    if anchor_report["anchored"]:
        print(f"Anchored {anchor_report['steps_anchored']} steps against "
              f"MME ic {anchor_report['ic']}.")

    latest_doc = build_latest(date, generated_at, manifest_codes, slices)
    latest_doc["anchored"] = anchor_report["anchored"]
    store.put_json("latest/all-stations.json", latest_doc, cache_control=SHORT)

    print(f"Loading {len(manifest_codes)} station histories...")
    histories = load_histories(store, manifest_codes)
    today_means = update_histories(store, date, slices, manifest_codes, histories)

    print("Building rollups and summary...")
    for n, name in ((7, "7d"), (30, "30d")):
        roll = build_rollups(histories, window_dates(date, n), manifest_codes)
        store.put_json(f"rollups/{name}.json", roll, cache_control=SHORT)

    doc = build_cities(histories, select_cities(manifest, manifest_codes), date,
                       manifest, HISTORY_CAP)
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
        "anchoring": anchor_report,
    }
    store.put_json(f"reports/{date}.json", run_report, cache_control=SHORT)
    return run_report


def cities_only(store, date=None):
    """Build just rollups/cities.json from the histories already in the store."""
    manifest = load_manifest()
    manifest_codes = set(manifest["stations"])
    if date is None:
        idx = store.get_json("meta/dates.json")
        date = (idx or {}).get("latest") or datetime.date.today().isoformat()
    print(f"Loading {len(manifest_codes)} station histories...")
    histories = load_histories(store, manifest_codes)
    doc = build_cities(histories, select_cities(manifest, manifest_codes), date,
                       manifest, HISTORY_CAP)
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

    # dates stay ordered so history days keys insert chronologically
    histories = {}
    for date in all_dates:
        codes = [c for c in codes_for_date(store, date) if c in manifest_codes]
        date_slices = read_slices(store, date, codes)
        # Each date re-anchors against its own immutable numeric sidecar, so a
        # rebuild reproduces exactly what the daily runs produced.
        apply_anchoring(date_slices, store.get_json(f"{date}/numeric.json"))
        for code, b in date_slices.items():
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
