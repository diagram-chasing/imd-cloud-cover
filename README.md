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
   that fetches those JSON views and renders a D3-projected canvas pixel map.

Everything the frontend needs is precomputed by the daily Action; the site is
static (`adapter-static`, SPA fallback for `/station/[code]` deep-links).

## Develop

```sh
pnpm install
pnpm dev        # serves the committed /sample fixtures when VITE_R2_PUBLIC_URL is unset
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

- **Frontend:** Cloudflare Pages, build command `pnpm build`, output `build/`,
  env `VITE_R2_PUBLIC_URL` = the bucket's public URL.
- **R2:** attach a custom domain (r2.dev is rate-limited and ignores
  Cache-Control); allow CORS GET/HEAD from the Pages domain + `localhost:5173`.
- **Pipeline:** set the four `R2_*` secrets on the repo; the Action runs daily.
  First deploy: trigger `workflow_dispatch`, then run `aggregate.py --rebuild`
  once with R2 creds to backfill histories from existing dated files.

## Data note

What's shown is the model's **day-0 forecast** (eight 3-hourly steps from
midnight IST), not a satellite observation. Not an official forecast.
