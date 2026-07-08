"""One-off parallel backfill: aggregate.py --rebuild, but with concurrent R2 reads.

The sequential rebuild fetches every dated slice one at a time (~170k GETs).
This driver produces byte-identical output by reusing aggregate.py's builders,
but pulls the raw slices through a thread pool and memoizes reads so the
latest-date view pass doesn't re-fetch what we already hold.

Usage (from scraper/, with R2 creds in .env):
    python tools/backfill.py [--workers 32]
"""

import argparse
import concurrent.futures as cf
import datetime
import sys
import threading

sys.path.insert(0, ".")

from dotenv import load_dotenv

load_dotenv()

from aggregate import (
    DATE_RE,
    HISTORY_CAP,
    SHORT,
    aggregate_date,
    day0_bands,
    history_entry,
    upload_manifest,
)
from storage import get_store


class CachingStore:
    """Read-memoizing wrapper so aggregate_date's repeated history/list reads hit memory."""

    def __init__(self, inner):
        self.inner = inner
        self._json = {}
        self._lists = {}
        self._lock = threading.Lock()

    def get_json(self, key):
        with self._lock:
            if key in self._json:
                return self._json[key]
        val = self.inner.get_json(key)
        with self._lock:
            self._json[key] = val
        return val

    def put_json(self, key, obj, cache_control=None, indent=None):
        self.inner.put_json(key, obj, cache_control=cache_control, indent=indent)
        with self._lock:
            self._json[key] = obj

    def list_keys(self, prefix):
        with self._lock:
            if prefix in self._lists:
                return self._lists[prefix]
        val = self.inner.list_keys(prefix)
        with self._lock:
            self._lists[prefix] = val
        return val

    def __getattr__(self, name):
        return getattr(self.inner, name)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=32)
    args = ap.parse_args()

    store = CachingStore(get_store())
    generated_at = datetime.datetime.now(datetime.timezone.utc).isoformat()

    print("Listing bucket ...", flush=True)
    pairs = []  # (date, code)
    for key in store.list_keys(""):
        m = DATE_RE.match(key)
        if m:
            pairs.append((m.group(1), m.group(2)))
    dates = sorted({d for d, _ in pairs})
    if not dates:
        print("No dated files found.")
        return
    print(f"{len(pairs)} slices across {len(dates)} dates: {dates[0]}..{dates[-1]}", flush=True)

    manifest = upload_manifest(store)
    manifest_codes = set(manifest["stations"].keys())
    latest_date = dates[-1]

    # Fetch every mapped slice concurrently. Latest-date slices are fetched for
    # all codes (mapped or not) so aggregate_date's read pass hits the cache.
    wanted = [(d, c) for d, c in pairs if c in manifest_codes or d == latest_date]
    done = 0
    hist_days = {}  # code -> {date: entry}
    lock = threading.Lock()

    def fetch(pair):
        date, code = pair
        raw = store.get_json(f"{date}/{code}-meteogram.json")
        bands = day0_bands(raw) if raw is not None else None
        if bands is None or code not in manifest_codes:
            return
        entry = history_entry(*bands)
        with lock:
            hist_days.setdefault(code, {})[date] = entry

    with cf.ThreadPoolExecutor(max_workers=args.workers) as ex:
        for _ in ex.map(fetch, wanted):
            done += 1
            if done % 5000 == 0:
                print(f"  fetched {done}/{len(wanted)}", flush=True)

    print(f"Fetched {len(wanted)} slices; {len(hist_days)} stations have history.", flush=True)

    # Write history files (capped like the daily path) concurrently.
    def write_history(code):
        days = hist_days[code]
        if len(days) > HISTORY_CAP:
            days = dict(sorted(days.items())[-HISTORY_CAP:])
        doc = {"code": code, "kind": "day0-forecast", "days": days}
        store.put_json(f"history/{code}.json", doc, cache_control=SHORT)

    with cf.ThreadPoolExecutor(max_workers=args.workers) as ex:
        list(ex.map(write_history, sorted(hist_days)))
    print(f"Wrote {len(hist_days)} history files.", flush=True)

    # Latest views: every read aggregate_date needs is now cached, so this is
    # dominated by its sequential history PUTs (idempotent re-writes).
    report = aggregate_date(store, latest_date, generated_at)
    print(f"Rebuilt views for {latest_date}: {report['mapped_count']} mapped, "
          f"{len(report['unmapped'])} unmapped.", flush=True)


if __name__ == "__main__":
    main()
