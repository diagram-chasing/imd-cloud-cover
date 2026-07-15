# imd-cloud-cover

Code and data behind 'Mapping India's Clouds', a daily interactive map of cloud cover over India.

## Development

The frontend SvelteKit app can be run by:

```sh
pnpm install
pnpm dev
```

The scraper that collects the data is in [`scraper/`](scraper). It runs daily on GitHub Actions, downloads every station's meteogram, extracts the cloud-cover values, and publishes the dataset.

## Dataset

Daily cloud cover for ~1,245 IMD stations is available in [`data/`](data) as Parquet and CSV. Please note that these are day-0 *forecast* values from the IMD model, not real observations. Please refer to [`data/DATA.md`](data/DATA.md) for the data descriptions.

## License

Code is MIT. Data is ODbL.

## AI Declaration

Parts of this repo (code and docs) were written with help from Claude.
