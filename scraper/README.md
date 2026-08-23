# IMD Meteogram Pipeline

Pipeline for processing IMD's meteogram charts into data. We download the charts, pixel-extract the cloud-cover panel, and build the static data for the frontend. Run once daily via Github Actions.

## Setup

```bash
pip install -r requirements.txt
cp .env.example .env
```

In prod, please set `.env` with R2 credentials. For local dev you can skip
those and just set `LOCAL_MODE=1`.

## Daily Run

```bash
python pipeline.py scrape --out /tmp/run-results.json     # scrape + extract + upload
python pipeline.py numeric                                # MausamGram MME sidecar
python pipeline.py aggregate --results /tmp/run-results.json  # build derived views
python pipeline.py export                                 # public dataset to ../data
```

`scrape` downloads every station's meteogram, checks the chart geometry looks
right, extracts the forecast slice, and uploads `{date}/{CODE}-meteogram.{webp,json}`.
`numeric` writes the `{date}/numeric.json` MME sidecar that anchors the OCR
bands and supplies forecast rain. `aggregate` builds the frontend views listed
below, and `export` flattens the histories into the public CSV/Parquet dataset
in [`../data`](../data). Please see [DATA.md](../data/DATA.md) for what's in it.

A second job runs on its own schedule: `obs.py` refreshes `latest/obs.json`
(and `latest/sky.png`) every ~30 min from INSAT-3DS + IMD synop.

## Layout

| file | owns |
| --- | --- |
| `pipeline.py` | the daily flow: scrape/extract, MME sidecar, derived views, dataset export |
| `obs.py` | near-real-time observations: INSAT CTBT + MOSDAC decoding, synop join, sky.png |
| `forecast.py` | the forecast domain model: band parsing, daily means, MME anchoring, histories, city explorer |
| `storage.py` | R2/local byte store + shared helpers (manifest, insecure fetches) |

If the derived views ever get out of sync, rebuild everything from the dated
files already in the store:

```bash
python pipeline.py aggregate --rebuild
```

## R2 layout

```
{date}/{CODE}-meteogram.{webp,json}   raw per-station forecast (immutable)
{date}/numeric.json                   MausamGram MME sidecar (immutable)
meta/stations.json                    station manifest
meta/dates.json                       { dates:[...], latest }
latest/all-stations.json              today's 8-step day-0 slice per station
latest/summary.json                   national means, cloudiest/clearest, streaks
latest/obs.json, latest/sky.png       near-real-time observations
history/{CODE}.json                   per-day daily means (h,m,l,e), cap 400 days
rollups/7d.json, rollups/30d.json     per-station daily-mean series over window
rollups/cities.json                   city explorer view
reports/{date}.json                   run report (succeeded/failed/suspicious/unmapped)
```
