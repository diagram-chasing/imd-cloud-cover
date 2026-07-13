# imd-cloud-cover

The IMD publishes a forecast chart (a "meteogram") for each of its stations
every day at [nwp.imd.gov.in](https://nwp.imd.gov.in/). There's no machine-readable
feed behind it, just an image. So this dataset is built by reading the
cloud-cover panel out of the image pixels, recovering the high / middle / low
cloud fractions, and reducing them to the tables below.

Two things to keep in mind:

- These are **forecast** values (the day-0 portion of the model run), not
  observations.
- Coverage grows one day at a time from when the scraper first ran, and each
  station keeps at most its last 400 days. A station shows up from the first
  day its meteogram parsed successfully and around 1,245 are tracked.

## Data dictionary

### Cloud cover — daily ([cloud-cover-daily.parquet](cloud-cover-daily.parquet) · [cloud-cover-daily.csv.zip](cloud-cover-daily.csv.zip))

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

### Cloud cover — 3-hourly ([cloud-cover-3hourly.parquet](cloud-cover-3hourly.parquet) · [cloud-cover-3hourly.csv.zip](cloud-cover-3hourly.csv.zip))

Same data before the daily averaging: one row per station per 3-hour step.

| Variable | Type | Description |
|----------|------|-------------|
| date | string | Forecast day (YYYY-MM-DD, IST) |
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

## Source

IMD Numerical Weather Prediction meteograms, <https://nwp.imd.gov.in/>.
