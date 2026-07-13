# IMD Meteogram Pipeline

This is the pipeline that turns IMD's meteogram PNGs into data. It downloads
the charts, pixel-extracts the cloud-cover panel, and builds the static JSON
the frontend reads. A GitHub Actions workflow runs it once a day.

## Setup

```bash
pip install -r requirements.txt
cp .env.example .env
```

The `.env` holds R2 credentials for production. For local dev you can skip
those and just set `LOCAL_MODE=1`.

## What a daily run looks like

```bash
python main.py --out /tmp/run-results.json          # scrape + extract + upload
python aggregate.py --results /tmp/run-results.json # build derived views
python export.py                                    # write public dataset to ../data
```

`main.py` downloads every station's meteogram, checks the chart geometry looks right, extracts the day-0 slice, and uploads
`{date}/{CODE}-meteogram.{webp,json}`. If fewer than 80% of stations succeed it exits non-zero so the workflow fails loudly rather than publishing a bad day.

`aggregate.py` then reads those day-0 slices and writes the frontend view listed below. `export.py` flattens the histories into the public CSV/Parquet
dataset in [`../data`](../data). Please see [DATA.md](../data/DATA.md) for what's in it.

## Occasionally useful

Re-seed the station manifest from the IMD page (grabs code, name, lat, lon;
figures out the state via point-in-polygon against `static/data/india.json`):

```bash
python tools/seed_stations.py --states ../static/data/india.json --merge
```
If the derived views ever get out of sync, rebuild everything from the dated
files already in the store:

```bash
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
