METHODOLOGY NOTE: MAPPING INDIA'S CLOUDS

WHAT THIS IS

This project turns the India Meteorological Department's daily GFS meteogram charts into an interactive pixel map of cloud cover over India, plus a per-city explorer. It is important to state up front that the underlying numbers are model forecast output, not ground observation. Every station's chart is a 10-day GFS forecast issued that day; we read only the first day of it and treat that as the day's reading. So "observed cloudiness" here means "the forecast for the current day, extracted from the official IMD chart", not a satellite or sky-camera measurement.

THE SOURCE

IMD publishes a meteogram GIF per forecast station at nwp.imd.gov.in/gfs_meteograms_mausam.php. Each GIF stacks several forecast panels; the one we care about is the cloud-cover panel, which shows three stacked bands of cloudiness over time: high cloud, middle cloud, and low cloud. There are roughly 1245 stations in the manifest. IMD does not publish the numbers behind these charts, so we recover them by reading the pixels.

STEP 1: DISCOVERY AND DOWNLOAD (scraper/main.py)

The scraper fetches the meteogram index page and scrapes out every station's GIF link with a regex against the gfs/...-meteogram.gif paths. The station code is taken from the filename. It then downloads each GIF concurrently (a thread pool of 8 workers, with a small random 0.1 to 0.3 second jitter per request to be polite), using a shared pooled HTTP session. Each image is flattened onto a white background if it has transparency, converted to RGB, and if wider than 1200 px it is thumbnailed down to a 1200 px width so the downstream crop geometry is fixed and predictable. A daily run reports how many stations succeeded, failed, or looked suspicious, and it deliberately exits with a non-zero status (failing CI) if the success rate drops below 80 percent, which is the tripwire for IMD silently changing their chart format.

STEP 2: PIXEL EXTRACTION (scraper/extract_data.py)

This is the core measurement. Because every image is normalized to 1200 px wide, the cloud-cover panel always lands in the same rectangle, so we crop a fixed window (y from 866 to 952, x from 70 to 1090). Before trusting it, validate_crop checks the geometry: the width must be exactly the expected value, the image must be tall enough, and the bottom rows of the cropped panel must actually be the panel's saturated blue background (open sky reads as blue near the bottom). If the blue panel isn't detected, the station is failed rather than silently producing garbage. This converts a format change on IMD's side into a reported failure instead of corrupt data.

The extraction itself samples 80 evenly spaced columns across the panel width. The panel is split vertically into three equal bands (high, middle, low). Within each band and each sampled column, the algorithm scans down from the top and finds the first white pixel (all channels above 200). Cloud in these charts is drawn as white filling upward from the band's baseline, so the height of the white fill is proportional to cloudiness. The percentage for that column is (band height minus the first-white row index) divided by band height, times 100. In plain terms: how far up the white cloud fill reaches inside that band equals the percent cloud cover. This yields 80 three-hourly samples per band (the raw meteogram spans about ten days at 3-hour steps). validate_values then range-checks the output and flags degenerate cases (empty, all-zero, all-full, or out of the 0 to 100 range) as warnings rather than failures.

Each station's result is written twice: a WEBP copy of the normalized chart image (for provenance / display) and a JSON file of the extracted 3-hourly high/middle/low percentages, both keyed by date and station code.

STEP 3: STORAGE (scraper/storage.py)

Everything the pipeline reads or writes goes through one storage abstraction with two interchangeable backends: Cloudflare R2 in production, or a local directory when LOCAL_MODE is set (for dev and tests). This guarantees the scrape path and the aggregation path never drift. Cache-Control is set by key prefix: dated raw snapshots are immutable and cached for a year, while the rolling/latest views that change daily get a short 5-minute TTL.

STEP 4: AGGREGATION INTO VIEWS (scraper/aggregate.py)

The raw per-station JSONs are not what the frontend consumes. aggregate.py derives a small set of static views from them. Key definitions used throughout:

The day-0 slice is the first 8 of the 3-hourly samples, i.e. 00:00 to 21:00 IST of the forecast's own first day. This is what the site calls "today". Effective cover, written as e, is the per-step maximum of the three bands (max of high, middle, low), and a daily effective mean is the mean of those per-step maxima. The idea is that from the ground the sky looks cloudy if any layer is covering it, so the max across layers approximates what a person would see.

The views produced:

latest/all-stations.json holds the day-0 8-step slice per station, plus a short tail of the next couple of forecast days (FORECAST_DAYS is 3). The tail exists so the client can show the visitor's current IST calendar day even before that day's scrape has run, keeping the site reading as genuinely "today".

history/{CODE}.json accumulates one entry per day per station: the daily means for each band plus the effective mean, plus t, the 8-step effective series (used by station-page time-of-day facts). Capped at 400 days.

rollups/7d.json and rollups/30d.json are per-station daily-mean series over the trailing week and month, null-filled on missing days, with a national mean that ignores nulls. These back the Week and Month tabs.

latest/summary.json carries national band means and the day's cloudiest and clearest stations.

rollups/cities.json is the long-term city explorer view, described next.

meta/stations.json and meta/dates.json are the station manifest and the date index.

The aggregation is idempotent (re-running for a date yields identical output), and a --rebuild mode reconstructs every history and view from scratch by re-reading all dated raw files.

THE CITY EXPLORER AND TWINS

build_cities selects cities that both matter (tier 2 or better, or population at least 100k) and have a mapped nearby station, deduping to the biggest city per station since a city's series is really its nearest station's history. For each city it computes daily effective cover on a shared calendar window, a long-term mean, counts of clear / grey / mixed days (clear if effective mean under 25, cloudy/grey if 70 or above), and longest runs including a longest "sunny drought".

Each city is also given two "twins", both required to be far away (at least 400 km and in a different state). The all-time twin is the city whose day-to-day cloud anomalies correlate best. The anomaly is the deviation from the city's own centered rolling mean (a plus/minus 10 day window), not from the national mean. This deseasonalizing against itself is deliberate: correlating raw values against the national day-mean made an always-overcast hill town and an always-clear desert both reduce to (constant minus national mean) and correlate perfectly, producing the nonsensical "cloudiest city twinned with clearest city" bug. Comparing each city's own fluctuations fixes that. Flat-sky cities whose anomaly standard deviation is too low sit out the all-time twin entirely (nothing to co-fluctuate). The today twin instead matches the shape of today's 8-step effective profile by lowest RMSE, because the daily mean is too coarse (dozens of cities share e=80) and the profile shape is what distinguishes them; flat-sky cities do participate here since sharing an overcast day is legitimate.

STEP 5: THE FRONTEND

Loading is split so first paint is cheap (src/lib/api/load.ts). The critical set (India outline as topojson, station manifest, today's readings, summary; about 300 KB) is fetched in the page load and serialized into the prerendered homepage, so it is present at hydration with no client round-trip. The deferred set (place labels, and the 7/30-day rollups; about 1.5 MB) loads in the background after first paint, or when the user zooms in or switches to Week/Month.

Value computation (src/lib/data.ts). computeValues resolves what number each station shows given the current view and control state. In Today view it reads the high/middle/low for the selected 3-hour time index, pulling from the forecast tail when the visitor's current IST day is past day 0. In Week/Month view it reads the daily mean for the selected day out of the corresponding rollup. resolveActiveDay picks the correct forecast day by matching the visitor's IST date against the available forecast days.

The map (src/lib/components/PixelMap.svelte). This is a Pixi.js (WebGL) canvas rendered as a deliberately pixel-art, oblique "from the side" view of India. India is projected with a conic-conformal projection fit to the frame (src/lib/map/projection.ts and map/geo.ts). The land, relief, coastline, shallow-water ring, urban areas, and night lights are pre-baked offline into day and night ground PNGs plus a mask; at runtime only the mask is decoded (to know land vs sea for wave placement) and the baked images are blitted, which keeps first paint fast.

Each station is drawn as a little three-tier "tower" of cloud sprites: high, middle, and low bands vertically offset, with a ground shadow whose darkness is driven by effective cover (higher bands contribute less, since thin cirrus casts almost nothing). Cloud amount is quantized into tiers that pick a sprite; sprites come from a generated atlas with a few random variants per tier so the map doesn't look uniform.

Performance and detail are managed by level-of-detail binning. At the zoomed-out landing view, stations are aggregated into coarse spatial bins (bin sizes 24, 16, 11 world px), and only when the user zooms all the way in is the finest per-station level (about 1245 marks) built lazily, which keeps the binning and sprite pools roughly four times smaller on first paint. A bin's displayed cloud value is the average of its member stations. Hover and tap use a quadtree for nearest-mark hit testing; hovering a multi-station bin shows the aggregated high/middle/low. City labels fade in only past a zoom threshold and are decluttered by a greedy overlap/spacing test so they never pile up. There is also a coarse IP-based "you are here" marker, ambient decoration (drifting balloon, sea waves), a day/night sky that follows the selected time of day, and a hidden debug camera panel toggled with the D key.

The city explorer (src/lib/components/city/CitySkyExplorer.svelte). This lazily fetches rollups/cities.json during idle time (or immediately if the reader scrolls it into view via an IntersectionObserver, with a timeout fallback so it fires even while the map keeps the main thread busy). It defaults the selected city to the visitor's nearest city if within 250 km of their coarse IP location, otherwise to the most populous city, and it remembers a pinned/stored choice. It offers an Overall vs Today toggle, a searchable city picker, a histogram of the city's cloud record, and a "sky twin" component that surfaces the precomputed far-away twin for the chosen mode.

CAVEATS AND HONEST LIMITS

The data is GFS model forecast, extracted day-0, not observation. Reading percentages off a rendered chart by pixel height is inherently approximate: anti-aliasing, chart re-rendering, or any geometry change on IMD's side degrades accuracy, which is why the validators and the 80 percent success-rate tripwire exist. Cloud tiers on the map are quantized for legibility, and coarse zoom levels show bin averages rather than individual stations. A city's record is really its single nearest station's record. Effective cover is a max-across-layers proxy for "what the sky looks like", not a physical total-cloud measurement.
