"""Export the public cloud-cover dataset into the repo-root `data/` folder.

Reads the per-station day-0 forecast histories (`history/{CODE}.json`) and the
station manifest that `aggregate.py` maintains, and flattens them into tidy
tables for public release. Precipitation is intentionally excluded — this is a
cloud-cover dataset.

Each table is written as Parquet (primary) plus CSV; the two large cloud tables
have their CSV zipped. See data/DATA.md for the dictionary.

    data/stations.{parquet,csv}              code -> name, state, lat, lon
    data/cloud-cover-daily.{parquet,csv.zip}   one row per station per day
    data/cloud-cover-3hourly.{parquet,csv.zip} one row per station per 3h step

Run it after `aggregate.py` has refreshed the histories:

    python export.py                  # read the configured store, write ../data
    LOCAL_MODE=1 python export.py      # read ./weather_data instead of R2

Values are integer percentages (0-100). `high`/`middle`/`low` are the daily-mean
cloud fractions of each band; `effective` is the daily mean of the per-step
maximum across bands (how overcast the sky reads overall).
"""

import argparse
import io
import os
import zipfile

import pyarrow as pa
import pyarrow.csv as pacsv
import pyarrow.parquet as pq

from aggregate import STEPS, here, load_histories, load_manifest
from storage import get_store

DAILY_FIELDS = ("h", "m", "l", "e")  # high, middle, low, effective


def data_dir(path=None):
    d = path or here("..", "data")
    os.makedirs(d, exist_ok=True)
    return d


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
        "lat": [float(stations[c]["lat"]) for c in codes],
        "lon": [float(stations[c]["lon"]) for c in codes],
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
            for time, e in zip(STEPS, t):
                cols["date"].append(date)
                cols["time"].append(time)
                cols["code"].append(c)
                cols["station"].append(name)
                cols["effective"].append(e)
    return pa.table(cols)


def export(store, out_dir):
    manifest = load_manifest()
    stations = manifest["stations"]
    codes = sorted(stations)
    print(f"Loading {len(codes)} station histories...")
    histories = load_histories(store, set(codes))

    n_st = write_table(out_dir, "stations", stations_table(stations, codes), zip_csv=False)
    n_day = write_table(out_dir, "cloud-cover-daily", daily_table(stations, histories, codes), zip_csv=True)
    n_3h = write_table(out_dir, "cloud-cover-3hourly", three_hourly_table(stations, histories, codes), zip_csv=True)

    with_history = sum(1 for c in codes if (histories.get(c) or {}).get("days"))
    print(f"Wrote {out_dir}:")
    print(f"  stations              {n_st} stations")
    print(f"  cloud-cover-daily     {n_day} rows ({with_history} stations with history)")
    print(f"  cloud-cover-3hourly   {n_3h} rows")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", help="output dir (default: repo-root data/)")
    args = ap.parse_args()
    export(get_store(), data_dir(args.out))


if __name__ == "__main__":
    main()
