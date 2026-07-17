# IMD Meteogram Pipeline

Pipeline for processing IMD's meteogram PNGs into data. We download the charts, pixel-extract the cloud-cover panel, and build the static data for the frontend. Run once daily via Github Actions.

## Setup

```bash
pip install -r requirements.txt
cp .env.example .env
```

In prod, please set `.env` with R2 credentials. For local dev you can skip
those and just set `LOCAL_MODE=1`.

## Daily Run

```bash
python main.py --out /tmp/run-results.json          # scrape + extract + upload
python aggregate.py --results /tmp/run-results.json # build derived views
python export.py                                    # write public dataset to ../data
```

`main.py` downloads every station's meteogram, checks the chart geometry looks right, extracts the day-0 slice, and uploads
`{date}/{CODE}-meteogram.{webp,json}`.

`aggregate.py` then reads those day-0 slices and writes the frontend view listed below. `export.py` flattens the histories into the public CSV/Parquet
dataset in [`../data`](../data). Please see [DATA.md](../data/DATA.md) for what's in it.

Two more jobs run on their own schedules: `collect_numeric.py` writes the
MausamGram MME sidecar `{date}/numeric.json` (used by aggregate to anchor the
OCR bands and supply forecast rain), and `collect_obs.py` refreshes
`latest/obs.json` every ~30 min from INSAT-3DS + IMD synop.

## Layout

Entry points, one per scheduled job:

| script | job |
| --- | --- |
| `main.py` | scrape meteogram GIFs, OCR the cloud panel (`extract_data.py`), upload raws |
| `collect_numeric.py` | fetch the MausamGram MME sidecar (`mausamgram.py`) |
| `collect_obs.py` | near-real-time observations (`mosdac.py`, `synop.py`) |
| `aggregate.py` | build all derived views (`anchor.py`, `cities.py`) |
| `export.py` | public CSV/Parquet dataset |

Shared modules (nothing imports an entry point):

| module | owns |
| --- | --- |
| `bands.py` | the day-0 band model: parse raw slices, daily means, effective cover |
| `histories.py` | `history/{CODE}.json` documents + the 400-day retention policy |
| `cities.py` | the city-explorer view and sky-twin assignment |
| `anchor.py` | anchoring OCR bands to the MME total; attaching rain |
| `storage.py` | R2/local byte store + concurrent store-op helper |
| `common.py` | manifest access and small shared utilities |

## Occasionally useful

Re-seed the station manifest from the IMD page. This grabs the code + lat/lon,
then enriches each station with IMD geography data: state/district/subdivision
by point-in-polygon against IMD's `imd:india_districts`, a real name by coordinate
match against IMD station layers.

```bash
python tools/fetch_imd_gazetteer.py     # caches scraper/data/imd/*.json
python tools/seed_stations.py --merge   # reads scraper/data/imd + geonames-places.json
```

`--merge` keeps any field whose `*_source` is `"manual"` (hand edits). The
GeoNames input (`scraper/data/geonames-places.json`) is distilled by
`node scripts/build-places.mjs` from `src/lib/assets/IN.zip`.
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
