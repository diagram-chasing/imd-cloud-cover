# imd-cloud-cover

Code and data behind 'Mapping India's Clouds', a daily interactive map of cloud cover over India. The India Meteorological Department publishes per-station GFS forecast charts (meteograms) as PNGs, and we read the cloud-cover panel back out of the pixels.

## Running it

The frontend SvelteKit app can be run by:

```sh
pnpm install
pnpm dev
```

The scraper that feeds it is in [`scraper/`](scraper). It runs daily on GitHub Actions, downloads every station's meteogram, extracts the cloud-cover values, and publishes the dataset.

## Dataset

Daily cloud cover for ~1,245 IMD stations, in [`data/`](data) as Parquet and CSV. These are day-0 *forecast* values from the model, not observations. [`data/DATA.md`](data/DATA.md) has column definitions and the rest of the fine print.

## License

Code is MIT. Data is ODbL.

## AI Declaration

Parts of this repo (code and docs) were written with help from Claude.
