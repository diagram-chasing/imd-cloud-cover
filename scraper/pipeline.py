"""The daily meteogram pipeline, one subcommand per stage (run in this order):

    python pipeline.py scrape --out /tmp/run-results.json
    python pipeline.py numeric
    python pipeline.py aggregate --results /tmp/run-results.json
    python pipeline.py export

scrape downloads every station's meteogram GIF, pixel-extracts the cloud-cover
panel and uploads {date}/{CODE}-meteogram.{webp,json}. numeric fetches the
MausamGram MME sidecar {date}/numeric.json. aggregate builds all derived views
(latest/*, history/*, rollups/*, reports/*; --rebuild regenerates everything
from stored raws). export writes the public CSV/Parquet dataset to ../data.
"""

import argparse
import datetime
import io
import json
import math
import os
import random
import re
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from io import BytesIO

import cv2
import numpy as np
import pyarrow as pa
import pyarrow.csv as pacsv
import pyarrow.parquet as pq
import requests
from dotenv import load_dotenv
from PIL import Image
from requests.adapters import HTTPAdapter
from tqdm import tqdm

from forecast import (BANDS, DAY0_SAMPLES, FORECAST_DAYS, HISTORY_CAP,
                      RAW_FIELDS, STEPS, apply_anchoring, attach_rain,
                      build_cities, cap_days, codes_for_date, day0,
                      history_entry, list_dates, load_histories, mean_round,
                      put_histories, read_slices, select_cities,
                      update_histories)
from storage import SHORT, get_store, here, load_manifest, to_float

load_dotenv()


# Crop of the cloud-cover panel within the (thumbnailed, width==1200) meteogram.
CROP_Y0, CROP_Y1 = 866, 952
CROP_X0, CROP_X1 = 70, 1090
EXPECTED_WIDTH = 1100


class ExtractionError(Exception):
    def __init__(self, stage, reason):
        self.stage = stage
        self.reason = reason
        super().__init__(f"{stage}: {reason}")


def validate_crop(pil_image):
    """Catch IMD chart geometry changes before they cause silent corruption."""
    if pil_image.width != EXPECTED_WIDTH:
        raise ExtractionError("validate_crop", f"width {pil_image.width} != {EXPECTED_WIDTH}")
    if pil_image.height < CROP_Y1:
        raise ExtractionError("validate_crop", f"height {pil_image.height} < {CROP_Y1}")

    arr = np.array(pil_image.convert("RGB"))
    crop = arr[CROP_Y0:CROP_Y1, CROP_X0:CROP_X1]
    # The panel background is a saturated blue; sample the bottom rows where
    # cover is usually 0 and confirm blue dominates there at least somewhere.
    bottom = crop[-6:, :, :]
    b, g, r = bottom[:, :, 2], bottom[:, :, 1], bottom[:, :, 0]
    bluish = (b.astype(int) > r.astype(int) + 20) & (b.astype(int) > 80)
    if bluish.mean() < 0.15:
        raise ExtractionError("validate_crop", f"blue panel not detected (bluish={bluish.mean():.2f})")


def validate_values(cloud_data):
    warnings = []
    for band_name, values in zip(("high", "middle", "low"), cloud_data):
        arr = np.asarray(values)
        if arr.size == 0:
            warnings.append(f"{band_name}: empty")
            continue
        if (arr < 0).any() or (arr > 100).any():
            warnings.append(f"{band_name}: out-of-range values")
        if np.all(arr == 0):
            warnings.append(f"{band_name}: all-zero")
        if np.all(arr >= 99.9):
            warnings.append(f"{band_name}: all-full")
    return warnings


def extract_cloud_data(pil_image, start_date):
    """80-sample h/m/l cloud percentages read off the meteogram panel: each
    band's cover is the fraction of the band's height above the first white
    pixel in the sampled column."""
    img_array = np.array(pil_image.convert('RGB'))
    img_bgr = cv2.cvtColor(img_array, cv2.COLOR_RGB2BGR)

    cropped = img_bgr[CROP_Y0:CROP_Y1, CROP_X0:CROP_X1]
    h, w = cropped.shape[:2]

    samples = 80
    x_indices = np.linspace(80, w - 5, samples).astype(int)
    sampled_img = cropped[:, x_indices, :]

    bands = np.array_split(sampled_img, 3, axis=0)
    cloud_data = []

    for band in bands:
        band_h = band.shape[0]
        is_white = (band > 200).all(axis=2)

        has_white = is_white.any(axis=0)
        first_white_idx = np.where(has_white, is_white.argmax(axis=0), band_h)

        percentage = ((band_h - first_white_idx) / band_h) * 100
        cloud_data.append(percentage.tolist())

    times = [start_date + timedelta(hours=i*3) for i in range(samples)]

    result = {
        "start_date": start_date.isoformat(),
        "samples": samples,
        "data": []
    }

    for i in range(samples):
        result["data"].append({
            "datetime": times[i].isoformat(),
            "high": round(cloud_data[0][i], 2),
            "middle": round(cloud_data[1][i], 2),
            "low": round(cloud_data[2][i], 2)
        })

    return result


def extract_to_json_buffer(pil_image, start_date, validate=True):
    """Extract cloud data into a JSON BytesIO buffer. Returns (buffer, warnings)."""
    if validate:
        validate_crop(pil_image)

    data = extract_cloud_data(pil_image, start_date)

    warnings = []
    if validate:
        bands = [
            [d["high"] for d in data["data"]],
            [d["middle"] for d in data["data"]],
            [d["low"] for d in data["data"]],
        ]
        warnings = validate_values(bands)

    json_str = json.dumps(data, indent=2)
    buffer = BytesIO()
    buffer.write(json_str.encode('utf-8'))
    buffer.seek(0)

    return buffer, warnings


BASE_URL = "https://nwp.imd.gov.in/gfs_meteograms_mausam.php"
DOMAIN = "https://nwp.imd.gov.in"

sess = requests.Session()
sess.mount("https://", HTTPAdapter(pool_connections=10, pool_maxsize=10))
sess.headers.update({"User-Agent": "Mozilla/5.0"})

# Match both gfs_meteograms and gfs_meteograms_dist paths, any case.
LINK_PATTERN = re.compile(r"['\"]\.?/(gfs/[a-zA-Z0-9_/-]+-meteogram\.gif)['\"]")


def get_gif_links():
    try:
        res = sess.get(BASE_URL, timeout=20)
        res.raise_for_status()
        return sorted(set(f"{DOMAIN}/{m}" for m in LINK_PATTERN.findall(res.text)))
    except Exception:
        return []


def process_gif(url, date, store):
    """Download, extract, and store one station. Errors return {code, stage, reason}."""
    code = url.split("/")[-1].replace("-meteogram.gif", "")
    try:
        time.sleep(random.uniform(0.1, 0.3))

        res = sess.get(url, timeout=15)
        if res.status_code != 200:
            return {"code": code, "stage": "download", "reason": f"http {res.status_code}"}

        img = Image.open(BytesIO(res.content))
        if img.mode in ("RGBA", "P", "LA"):
            bg = Image.new("RGB", img.size, (255, 255, 255))
            bg.paste(img, mask=img.split()[-1] if img.mode == "RGBA" else None)
            img = bg
        else:
            img = img.convert("RGB")

        if img.width > 1200:
            img.thumbnail((1200, 4000), Image.Resampling.LANCZOS)

        start = datetime.datetime.combine(
            datetime.date.fromisoformat(date), datetime.time(0, 0)
        )
        try:
            json_buf, warnings = extract_to_json_buffer(img, start)
        except ExtractionError as e:
            return {"code": code, "stage": e.stage, "reason": e.reason}

        webp_buf = BytesIO()
        img.save(webp_buf, format="WEBP", quality=80, method=6)

        store.put_fileobj(webp_buf, f"{date}/{code}-meteogram.webp", "image/webp")
        store.put_fileobj(json_buf, f"{date}/{code}-meteogram.json", "application/json")

        result = {"code": code, "ok": True}
        if warnings:
            result["warnings"] = warnings
        return result
    except Exception as e:  # noqa: BLE001 — capture reason, don't swallow
        return {"code": code, "stage": "process", "reason": str(e)[:200]}


def cmd_scrape(args):
    store = get_store()
    date = args.date or datetime.date.today().isoformat()
    urls = get_gif_links()
    if not urls:
        print("No URLs found.")
        if args.out:
            with open(args.out, "w") as f:
                json.dump({"date": date, "succeeded": [], "failed": [],
                          "suspicious": [], "discovered": 0}, f)
        return

    if args.limit:
        urls = urls[: args.limit]

    print(f"Processing {len(urls)} files for {date}...")

    results = []
    with ThreadPoolExecutor(max_workers=8) as ex:
        for r in tqdm(ex.map(lambda u: process_gif(u, date, store), urls), total=len(urls)):
            results.append(r)

    succeeded = [r["code"] for r in results if r.get("ok")]
    failed = [{"code": r["code"], "stage": r["stage"], "reason": r["reason"]}
              for r in results if not r.get("ok")]
    suspicious = [{"code": r["code"], "warnings": r["warnings"]}
                  for r in results if r.get("ok") and r.get("warnings")]

    n = len(urls)
    rate = len(succeeded) / n if n else 0
    print(f"Done. Success: {len(succeeded)} | Failed: {len(failed)} | "
          f"Suspicious: {len(suspicious)} | Rate: {rate:.0%}")

    report = {
        "date": date,
        "discovered": n,
        "succeeded": sorted(succeeded),
        "failed": failed,
        "failed_count": len(failed),
        "suspicious": suspicious,
        "success_rate": round(rate, 4),
    }
    if args.out:
        with open(args.out, "w") as f:
            json.dump(report, f, indent=2)
        print(f"Wrote run-results to {args.out}")

    # Signal CI failure if extraction success dropped below 80%.
    if n and rate < 0.80:
        raise SystemExit(f"Success rate {rate:.0%} below 80% threshold")


# MausamGram MME numeric point forecasts (IMD, 0.125-degree grid, 00Z runs).
# One JSON per grid cell per IC: 41 three-hourly steps, index 0 is the IC hour
# and always "NaN". The day's table fills progressively, so collect() falls
# back wholesale to yesterday's complete run (step shift +8) when coverage is
# poor.
MME_URL = "https://mausamgram.imd.gov.in/test4_mme.php"
GRID = 0.125
N_STEPS = 41
IST_OFFSET_STEPS = 2  # 00Z = 05:30 IST ~= 2 three-hour steps
MIN_COVERAGE = 0.9
MME_MAX_WORKERS = 6


def snap(v):
    return math.floor(v / GRID) * GRID


def fetch_cell(lat, lon, ic, mme_sess):
    """{"tc": [41], "p": [41]} (float-or-None) for one snapped cell, or None."""
    params = {"lat_gfs": f"{snap(lat):.3f}", "lon_gfs": f"{snap(lon):.3f}",
              "date": f"{ic}_3hr_0p125"}
    for attempt in range(3):
        try:
            time.sleep(random.uniform(0.1, 0.3))
            doc = mme_sess.get(MME_URL, params=params, timeout=20).json()
            tc, p = doc.get("tcdc"), doc.get("apcp")
            if not (isinstance(tc, list) and len(tc) == N_STEPS
                    and isinstance(p, list) and len(p) == N_STEPS):
                return None
            return {"tc": [to_float(v) for v in tc], "p": [to_float(v) for v in p]}
        except Exception:  # noqa: BLE001 — flaky govt endpoint; retry then give up
            if attempt == 2:
                return None
            time.sleep(2 ** attempt)


def align_indices(n_display, shift):
    """Model index per IST display step (8/day): k = 8d + j - 2 + shift,
    clamped to the valid 1..40 range (index 0 is the NaN IC hour)."""
    return [max(1, min(N_STEPS - 1, 8 * (i // 8) + i % 8 - IST_OFFSET_STEPS + shift))
            for i in range(n_display)]


def collect(stations, date, n_display_steps):
    """Fetch tcdc/apcp for every station ({code: (lat, lon)}), deduped by grid
    cell. Returns the numeric.json payload, or None when unreachable."""
    mme_sess = requests.Session()
    mme_sess.headers.update({"User-Agent": "Mozilla/5.0"})

    cells = {}
    for code, (lat, lon) in stations.items():
        cells.setdefault((snap(lat), snap(lon)), []).append(code)
    keys = sorted(cells)

    d = datetime.date.fromisoformat(date)
    best = None  # (coverage, ic, shift, fetched)
    for ic, shift in ((f"{d:%Y%m%d}00", 0),
                      (f"{d - datetime.timedelta(days=1):%Y%m%d}00", 8)):
        with ThreadPoolExecutor(max_workers=MME_MAX_WORKERS) as ex:
            fetched = list(ex.map(lambda k: fetch_cell(k[0], k[1], ic, mme_sess), keys))
        cov = sum(c is not None for c in fetched) / len(keys)
        if best is None or cov > best[0]:
            best = (cov, ic, shift, fetched)
        if cov >= MIN_COVERAGE:
            break
    coverage, ic, shift, fetched = best
    if coverage == 0:
        return None

    idx = align_indices(n_display_steps, shift)
    out = {}
    for key, cell in zip(keys, fetched):
        if cell is None:
            continue
        row = {"tc": [None if cell["tc"][k] is None else round(cell["tc"][k])
                      for k in idx],
               "p": [None if cell["p"][k] is None else round(max(0.0, cell["p"][k]), 1)
                     for k in idx]}
        for code in cells[key]:
            out[code] = row
    print(f"mausamgram: ic {ic} shift {shift}, "
          f"{sum(c is not None for c in fetched)}/{len(keys)} cells")
    return {"date": date, "ic": ic, "shift": shift,
            "steps": n_display_steps, "stations": out}


def cmd_numeric(args):
    date = args.date or datetime.date.today().isoformat()

    stations = {code: (s["lat"], s["lon"])
                for code, s in load_manifest()["stations"].items()}
    print(f"Fetching MausamGram numerics for {len(stations)} stations ({date})...")
    doc = collect(stations, date, FORECAST_DAYS * DAY0_SAMPLES)
    if doc is None or not doc["stations"]:
        print("MausamGram unavailable; skipping numeric sidecar.")
        return
    get_store().put_json(f"{date}/numeric.json", doc)
    print(f"Wrote {date}/numeric.json: {len(doc['stations'])} stations.")


def build_latest(date, generated_at, manifest_codes, slices):
    """latest/all-stations.json: day-0 slice per station plus multi-day forecast tail."""
    mapped = {c: b for c, b in slices.items() if c in manifest_codes}
    stations = {c: day0(b) for c, b in mapped.items()}

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
    """Per-station daily-mean series over dates_window; null-fill missing days."""
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


def update_dates_index(store, latest_date, dates):
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


def aggregate_date(store, date, generated_at, report=None):
    """Build all derived views treating `date` as the latest snapshot."""
    manifest = upload_manifest(store)
    manifest_codes = set(manifest["stations"])

    codes = codes_for_date(store, date)
    print(f"Reading {len(codes)} raw slices for {date}...")
    slices = read_slices(store, date, codes)
    unmapped = sorted(c for c in slices if c not in manifest_codes)

    # Anchor OCR bands against the MME numeric sidecar BEFORE any view is
    # built, so latest/histories/rollups agree.
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

    # Dates stay ordered so history days keys insert chronologically. Each date
    # re-anchors against its own immutable numeric sidecar, so a rebuild
    # reproduces exactly what the daily runs produced.
    histories = {}
    for date in all_dates:
        codes = [c for c in codes_for_date(store, date) if c in manifest_codes]
        date_slices = read_slices(store, date, codes)
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


def cmd_aggregate(args):
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


DAILY_FIELDS = ("h", "m", "l", "e")  # high, middle, low, effective


def write_table(out_dir, name, table, zip_csv):
    """Write `table` as {name}.parquet plus CSV ({name}.csv, or .csv.zip)."""
    pq.write_table(table, os.path.join(out_dir, f"{name}.parquet"), compression="zstd")
    buf = io.BytesIO()
    pacsv.write_csv(table, buf)
    if zip_csv:
        path = os.path.join(out_dir, f"{name}.csv.zip")
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr(f"{name}.csv", buf.getvalue())
    else:
        path = os.path.join(out_dir, f"{name}.csv")
        with open(path, "wb") as f:
            f.write(buf.getvalue())
    return table.num_rows


def stations_table(stations, codes):
    return pa.table({
        "code": codes,
        "station": [stations[c]["name"] for c in codes],
        "state": [stations[c].get("state") or "" for c in codes],
        "district": [stations[c].get("district") or "" for c in codes],
        "subdivision": [stations[c].get("subdivision") or "" for c in codes],
        "lat": [float(stations[c]["lat"]) for c in codes],
        "lon": [float(stations[c]["lon"]) for c in codes],
        "canonical": [bool(stations[c].get("canonical", True)) for c in codes],
    })


def places_table(stations, codes):
    """One row per station as a place: the station IS the place (IMD name/
    district/state); pop/tier describe the district's headline settlement and
    only rank notable places."""
    return pa.table({
        "code": codes,
        "name": [stations[c]["name"] for c in codes],
        "state": [stations[c].get("state") or "" for c in codes],
        "district": [stations[c].get("district") or "" for c in codes],
        "subdivision": [stations[c].get("subdivision") or "" for c in codes],
        "pop": [stations[c].get("pop") for c in codes],
        "tier": [stations[c].get("tier") for c in codes],
        "lat": [float(stations[c]["lat"]) for c in codes],
        "lon": [float(stations[c]["lon"]) for c in codes],
        "canonical": [bool(stations[c].get("canonical", True)) for c in codes],
    })


def daily_table(stations, histories, codes):
    cols = {k: [] for k in ("date", "code", "station", "high", "middle", "low", "effective")}
    for c in codes:
        days = (histories.get(c) or {}).get("days", {})
        name = stations[c]["name"]
        for date in sorted(days):
            d = days[date]
            if not all(k in d for k in DAILY_FIELDS):
                continue
            cols["date"].append(date)
            cols["code"].append(c)
            cols["station"].append(name)
            cols["high"].append(d["h"])
            cols["middle"].append(d["m"])
            cols["low"].append(d["l"])
            cols["effective"].append(d["e"])
    return pa.table(cols)


def three_hourly_table(stations, histories, codes):
    cols = {k: [] for k in ("date", "time", "code", "station", "effective")}
    for c in codes:
        days = (histories.get(c) or {}).get("days", {})
        name = stations[c]["name"]
        for date in sorted(days):
            t = days[date].get("t")
            if not t or len(t) != len(STEPS):
                continue
            for time_, e in zip(STEPS, t):
                cols["date"].append(date)
                cols["time"].append(time_)
                cols["code"].append(c)
                cols["station"].append(name)
                cols["effective"].append(e)
    return pa.table(cols)


def update_coverage(out_dir, daily, n_stations):
    """Rewrite the coverage table in data/DATA.md between the coverage markers."""
    path = os.path.join(out_dir, "DATA.md")
    if daily.num_rows == 0 or not os.path.exists(path):
        return
    dates = daily.column("date").to_pylist()
    table = (
        "| First day | Latest day | Stations tracked |\n"
        "|-----------|------------|----------------|\n"
        f"| {min(dates)} | {max(dates)} | ~{n_stations:,} |"
    )
    start, end = "<!-- coverage:start", "<!-- coverage:end -->"
    with open(path) as f:
        text = f.read()
    i, j = text.find(start), text.find(end)
    if i == -1 or j == -1:
        print(f"  (coverage markers not found in {path}; table not updated)")
        return
    with open(path, "w") as f:
        f.write(text[: text.index("\n", i) + 1] + table + "\n" + text[j:])


def cmd_export(args):
    store = get_store()
    out_dir = args.out or here("..", "data")
    os.makedirs(out_dir, exist_ok=True)

    manifest = load_manifest()
    stations = manifest["stations"]
    codes = sorted(stations)
    print(f"Loading {len(codes)} station histories...")
    histories = load_histories(store, set(codes))

    daily = daily_table(stations, histories, codes)
    n_st = write_table(out_dir, "stations", stations_table(stations, codes), zip_csv=False)
    n_pl = write_table(out_dir, "places", places_table(stations, codes), zip_csv=False)
    n_day = write_table(out_dir, "cloud-cover-daily", daily, zip_csv=True)
    n_3h = write_table(out_dir, "cloud-cover-3hourly", three_hourly_table(stations, histories, codes), zip_csv=True)

    with_history = sum(1 for c in codes if (histories.get(c) or {}).get("days"))
    update_coverage(out_dir, daily, with_history)
    print(f"Wrote {out_dir}:")
    print(f"  stations              {n_st} stations")
    print(f"  places                {n_pl} places")
    print(f"  cloud-cover-daily     {n_day} rows ({with_history} stations with history)")
    print(f"  cloud-cover-3hourly   {n_3h} rows")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("scrape", help="scrape meteogram GIFs, extract, upload raws")
    sp.add_argument("--out", help="write run-results JSON here (for the aggregate step)")
    sp.add_argument("--date", help="snapshot date (YYYY-MM-DD); default today")
    sp.add_argument("--limit", type=int, help="only process the first N stations (debug)")
    sp.set_defaults(func=cmd_scrape)

    sp = sub.add_parser("numeric", help="fetch the MausamGram MME sidecar")
    sp.add_argument("--date", help="snapshot date (YYYY-MM-DD); default today")
    sp.set_defaults(func=cmd_numeric)

    sp = sub.add_parser("aggregate", help="build all derived views")
    sp.add_argument("--date", help="snapshot date (YYYY-MM-DD); default today")
    sp.add_argument("--results", help="run-results JSON from scrape (failures/discovered)")
    sp.add_argument("--generated-at", help="ISO timestamp for generated_at; default now")
    sp.add_argument("--rebuild", action="store_true",
                    help="rebuild everything from all dated files")
    sp.add_argument("--cities-only", action="store_true",
                    help="build just rollups/cities.json from existing histories")
    sp.set_defaults(func=cmd_aggregate)

    sp = sub.add_parser("export", help="export the public CSV/Parquet dataset")
    sp.add_argument("--out", help="output dir (default: repo-root data/)")
    sp.set_defaults(func=cmd_export)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
