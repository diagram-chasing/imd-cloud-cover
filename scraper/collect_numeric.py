"""Fetch MausamGram MME numerics for every manifest station into the immutable
per-date sidecar {date}/numeric.json (used by aggregate.py to anchor bands and
supply forecast rain). MausamGram down => write nothing, exit 0."""

import argparse
import datetime

from dotenv import load_dotenv

from aggregate import FORECAST_DAYS, DAY0_SAMPLES, load_manifest
from mausamgram import collect
from storage import get_store

load_dotenv()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="snapshot date (YYYY-MM-DD); default today")
    args = ap.parse_args()
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


if __name__ == "__main__":
    main()
