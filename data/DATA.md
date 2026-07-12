# imd-cloud-cover

The data is derived from the India Meteorological Department (IMD) GFS
**meteograms**, the per-station forecast charts published daily at
[nwp.imd.gov.in](https://nwp.imd.gov.in/). Each meteogram is a PNG; the
cloud-cover panel is pixel-extracted into numeric high / middle / low cloud
fractions, then reduced to the values below.

Coverage grows one day at a time from the first daily run and is capped at the
most recent 400 days per station. Roughly 1,245 stations are tracked; a station
appears from the first day its meteogram was successfully parsed.

## Data dictionary

### Cloud cover — daily ([cloud-cover-daily.parquet](cloud-cover-daily.parquet) · [cloud-cover-daily.csv.zip](cloud-cover-daily.csv.zip))

One row per station per day. The four cloud values are daily means over the
eight 3-hourly steps of the day-0 slice.

| Variable | Type | Description |
|----------|------|-------------|
| date | string | Forecast day the values describe (format: YYYY-MM-DD, IST) |
| code | string | Station code (join key to `stations.csv`) |
| station | string | Station name |
| high | int64 | Mean high-cloud cover, 0–100 (%) |
| middle | int64 | Mean middle-cloud cover, 0–100 (%) |
| low | int64 | Mean low-cloud cover, 0–100 (%) |
| effective | int64 | Mean of the per-step maximum of the three bands, 0–100 (%). |

### Cloud cover — 3-hourly ([cloud-cover-3hourly.parquet](cloud-cover-3hourly.parquet) · [cloud-cover-3hourly.csv.zip](cloud-cover-3hourly.csv.zip))

One row per station per 3-hour step.

| Variable | Type | Description |
|----------|------|-------------|
| date | string | Forecast day (format: YYYY-MM-DD, IST) |
| time | string | Step start time in IST (00:00, 03:00, … 21:00) |
| code | string | Station code (join key to `stations.csv`) |
| station | string | Station name |
| effective | int64 | Effective cloud cover for the step, 0–100 (%) |

### Stations ([stations.parquet](stations.parquet) · [stations.csv](stations.csv))

One row per station.

| Variable | Type | Description |
|----------|------|-------------|
| code | string | Station code (join key) |
| station | string | Station name |
| state | string | Indian state/UT the station falls in (empty if the point fell outside all boundaries) |
| lat | float64 | Latitude (decimal degrees) |
| lon | float64 | Longitude (decimal degrees) |


## Data source

Sourced from the IMD Numerical Weather Prediction meteograms at
<https://nwp.imd.gov.in/>. The pipeline that downloads, extracts and aggregates
them lives in [`../scraper`](../scraper).
