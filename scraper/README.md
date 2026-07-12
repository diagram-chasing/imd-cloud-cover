# IMD Meteogram Pipeline

Downloads IMD GFS meteograms, pixel-extracts the cloud-cover panel, and builds
the static JSON views the frontend consumes. Runs daily via GitHub Actions.

## Setup

```bash
pip install -r requirements.txt
cp .env.example .env   # R2 credentials (production); set LOCAL_MODE=1 for dev
```

## Daily run

```bash
python main.py --out /tmp/run-results.json          # scrape + extract + upload
python aggregate.py --results /tmp/run-results.json # build derived views
python export.py                                    # write public dataset to ../data
```

- `main.py` downloads every station's meteogram, validates geometry, extracts
  the day-0 slice, and uploads `{date}/{CODE}-meteogram.{webp,json}`. Exits
  non-zero if the success rate falls below 80%.
- `aggregate.py` reads the day-0 slices and writes the frontend views (below).
- `export.py` flattens the histories into the public CSV/Parquet dataset in
  [`../data`](../data) (see its [DATA.md](../data/DATA.md)).

## Tools

```bash
# Re-seed the station manifest from the IMD page (code, name, lat, lon; state via
# point-in-polygon against static/data/india.json). --merge keeps curated fields.
python tools/seed_stations.py --states ../static/data/india.json --merge

# Backfill all histories/rollups/summary from every dated file already in the store
python aggregate.py --rebuild
```

## R2 layout

```
{date}/{CODE}-meteogram.{webp,json}   raw per-station forecast (immutable)
meta/stations.json                    station manifest
meta/dates.json                       { dates:[...], latest }
latest/all-stations.json              today's 8-step day-0 slice per station
latest/summary.json                   national means, cloudiest/clearest, streaks
history/{CODE}.json                   per-day daily means (h,m,l,e), cap 400 days
rollups/7d.json, rollups/30d.json     per-station daily-mean series over window
reports/{date}.json                   run report (succeeded/failed/suspicious/unmapped)
```

"Observed" = the **day-0 slice** = first 8 samples (00:00..21:00 IST) of each
10-day forecast. Effective cover `e` = mean over steps of max(high, middle, low).
This is model forecast output, not observation.
