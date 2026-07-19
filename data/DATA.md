# imd-cloud-cover

The IMD publishes a forecast chart (a "meteogram") for each of its stations
every day at [nwp.imd.gov.in](https://nwp.imd.gov.in/). There's no machine-readable
feed behind it, just an image. So this dataset is built by reading the
cloud-cover panel out of the image pixels, recovering the high / middle / low
cloud fractions, and reducing them to the tables below.

Please note:

- These are forecast*values (the day-0 portion of that day's model run), not
  observations.
- Coverage grows one day at a time; each station keeps at most its last 400 days.

| First day | Latest day | Stations tracked | Per-station retention |
|-----------|------------|------------------|-----------------------|
| 2026-02-15 | 2026-07-18 | ~1,245 | 400 days |

- From July 2026 the pixel-extracted bands are *anchored* against IMD's
  MausamGram multi-model-ensemble total cloud (numeric, same 12 km grid) for
  days where that feed was reachable: when the two disagree by more than 20
  points, the bands are pulled halfway toward the ensemble total. The raw
  per-day extraction JSONs and the per-day `numeric.json` sidecars are both
  kept, so any day is reproducible either way.

## Data dictionary

### Cloud cover — daily ([cloud-cover-daily.parquet](https://raw.githubusercontent.com/diagram-chasing/imd-meteograms/main/data/cloud-cover-daily.parquet) · [cloud-cover-daily.csv.zip](https://raw.githubusercontent.com/diagram-chasing/imd-meteograms/main/data/cloud-cover-daily.csv.zip))

One row per station per day. The four cloud values are means over the eight
3-hourly steps of the day-0 slice.

| Variable | Type | Description |
|----------|------|-------------|
| date | string | Forecast day the values describe (YYYY-MM-DD, IST) |
| code | string | Station code (join key to `stations.csv`) |
| station | string | Station name |
| high | int64 | Mean high-cloud cover, 0–100 (%) |
| middle | int64 | Mean middle-cloud cover, 0–100 (%) |
| low | int64 | Mean low-cloud cover, 0–100 (%) |
| effective | int64 | Mean of the per-step max of the three bands, 0–100 (%) |

### Cloud cover — 3-hourly ([cloud-cover-3hourly.parquet](https://raw.githubusercontent.com/diagram-chasing/imd-meteograms/main/data/cloud-cover-3hourly.parquet) · [cloud-cover-3hourly.csv.zip](https://raw.githubusercontent.com/diagram-chasing/imd-meteograms/main/data/cloud-cover-3hourly.csv.zip))

Same data before the daily averaging: one row per station per 3-hour step.

| Variable | Type | Description |
|----------|------|-------------|
| date | string | Forecast day (YYYY-MM-DD, IST) |
| time | string | Step start time in IST (00:00, 03:00, … 21:00) |
| code | string | Station code (join key to `stations.csv`) |
| station | string | Station name |
| effective | int64 | Effective cloud cover for the step, 0–100 (%) |

### Stations ([stations.parquet](https://raw.githubusercontent.com/diagram-chasing/imd-meteograms/main/data/stations.parquet) · [stations.csv](https://raw.githubusercontent.com/diagram-chasing/imd-meteograms/main/data/stations.csv))

One row per station.

| Variable | Type | Description |
|----------|------|-------------|
| code | string | Station code (join key) |
| station | string | Station name (IMD synop/metar/nowcast, or the IMD district for opaque codes) |
| state | string | State/UT the station falls in (empty for foreign/offshore points) |
| district | string | IMD district the station falls in (empty if outside all boundaries) |
| subdivision | string | IMD meteorological subdivision |
| lat | float64 | Latitude (decimal degrees) |
| lon | float64 | Longitude (decimal degrees) |
| canonical | bool | `false` when the station shares a place/name with another (e.g. a district-wide meteogram plus a point station in the same district); the canonical one represents the place in listings |

### Places ([places.parquet](https://raw.githubusercontent.com/diagram-chasing/imd-meteograms/main/data/places.parquet) · [places.csv](https://raw.githubusercontent.com/diagram-chasing/imd-meteograms/main/data/places.csv))

Locations extracted from IMD to give stations readable names. Population and tier was arrived at by joining GeoNames.

| Variable | Type | Description |
|----------|------|-------------|
| code | string | Station code (join key to `stations.csv`) |
| name | string | Place / station name |
| state | string | State/UT (empty for foreign/offshore points) |
| district | string | IMD district |
| subdivision | string | IMD meteorological subdivision |
| pop | int64 | Population of the district's headline settlement (null if unknown) |
| tier | int64 | 0 = megacity (≥5M), 1 = major (≥1M), 2 = city (≥200k), 3 = town; null if unknown |
| lat | float64 | Latitude (decimal degrees) |
| lon | float64 | Longitude (decimal degrees) |
| canonical | bool | `false` for a station that duplicates another place; filter to `canonical = true` for one row per place |

## Reproducing this dataset

Everything here is regenerated from the scraper pipeline in
[`../scraper`](../scraper) (see its [README](../scraper/README.md) for setup and
the scheduled jobs). The public tables are the last step:

```bash
cd scraper
pip install -r requirements.txt
python main.py --out /tmp/run-results.json          # scrape + pixel-extract each meteogram
python aggregate.py --results /tmp/run-results.json # build derived views (anchor bands, cities)
python export.py                                    # flatten histories → ../data/*.{parquet,csv.zip}
```

`main.py` reads the day's charts from <https://nwp.imd.gov.in/>; each run appends
one more day, so historical days can only be rebuilt from raws already collected.

## Source

- **Cloud cover** from IMD Numerical Weather Prediction meteograms,
  <https://nwp.imd.gov.in/>.
- **Station geography** (name, state, district, subdivision) from IMD's own GeoServer
  layers: `imd:india_districts` (state/district by point-in-polygon) and the
  `imd:synop_data_layer` / `imd:metar_data_layer` / `imd:NowcastWarningStation`
  station layers (real names by coordinate match), via
  <https://reactjs.imd.gov.in/geoserver/imd/wfs>.
- **Population / tier** from [GeoNames](https://www.geonames.org/) (CC BY 4.0), joined to
  each station's IMD district (district-headline settlement).
