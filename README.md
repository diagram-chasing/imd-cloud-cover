# Aaj Ka Aasmaan — India's Sky, Daily

A daily-updating, Pudding-style interactive: a stylized pixel map of cloud cover
over India, read from the India Meteorological Department's GFS meteograms. Three
cloud _species_ (high cirrus / mid alto / low cumulus), a rotating seasonal lens,
streak mechanics, and night skies where pixel stars appear only where it's clear.

## How it works

1. **Pipeline** (`scraper/`, GitHub Actions, daily 11:00 IST): downloads every
   station's meteogram, pixel-extracts the cloud-cover panel (the day-0 slice =
   first 8 of each 10-day forecast), and writes derived JSON views to Cloudflare
   R2. See [`scraper/README.md`](scraper/README.md).
2. **Frontend** (`src/`, SvelteKit + Svelte 5 runes + D3): a fully static site
   rendering a D3-projected canvas pixel map. The core views (manifest, latest,
   summary, rollups) are **baked into each deploy** by `scripts/bake-data.mjs`
   and preloaded from the prerendered homepage `<head>`; per-station
   history/forecast JSON and the raw meteogram images are fetched on demand from
   a read-only Cloudflare Worker in front of the bucket (`worker/`).
3. **Deploy** (Netlify): builds on push to `main`; the daily scrape workflow
   also hits a Netlify build hook so the baked data is exactly as fresh as the
   pipeline.

Everything the frontend needs is precomputed by the daily Action; the site is
static (`adapter-static`, prerendered `/`, SPA fallback for `/station/[code]`
deep-links).

## Develop

```sh
pnpm install
pnpm dev        # bakes fresh core views from the Worker (VITE_R2_PUBLIC_URL in .env);
                # falls back to the committed /sample fixtures when unset
pnpm bake       # force-refresh static/baked/ from the Worker
pnpm check      # svelte-check
pnpm build      # static build -> build/
```

`static/sample/` holds a committed snapshot (manifest, latest, summary, rollups)
so the site works offline. Per-station history/forecasts are gitignored dev
fixtures — regenerate them locally with:

```sh
cd scraper && LOCAL_MODE=1 python main.py --out /tmp/run.json && \
  LOCAL_MODE=1 python aggregate.py --results /tmp/run.json
# then copy scraper/weather_data/{history,YYYY-MM-DD}/*.json into static/sample/
```

## Deploy

- **Data endpoint:** `worker/` is a read-only Worker over the R2 bucket
  (GET/HEAD, path allowlist, CORS for the site origin + localhost). Deploy with
  `cd worker && wrangler deploy`; its URL is `VITE_R2_PUBLIC_URL`.
- **Frontend:** Netlify, configured by `netlify.toml` (build `pnpm build`,
  publish `build/`). Create a build hook (Site settings → Build & deploy) and
  save its URL as the `NETLIFY_BUILD_HOOK` repo secret so the daily scrape can
  trigger a data rebuild.
- **Pipeline:** set the four `R2_*` secrets on the repo; the Action runs daily.
  First deploy: trigger `workflow_dispatch`, then run `aggregate.py --rebuild`
  (or the parallel `tools/backfill.py`) once with R2 creds to backfill histories
  from existing dated files.

## Data note

What's shown is the model's **day-0 forecast** (eight 3-hourly steps from
midnight IST), not a satellite observation. Not an official forecast.
