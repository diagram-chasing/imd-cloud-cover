# imd-cloud-cover

Data pipeline and visualization for 'Mapping India's Clouds', a daily interactive map
of cloud cover over India, read from the India Meteorological Department's GFS
meteograms.

## Getting Started

The scraper in the `scraper` directory downloads the IMD meteograms daily,
pixel-extracts the cloud-cover panel, and publishes the open dataset to the
`data` directory. See [`scraper/README.md`](scraper/README.md).

Frontend visualization components are in the `src` directory.

1. Install dependencies:

   ```sh
   pnpm install
   ```

2. Run the dev server:

   ```sh
   pnpm dev
   ```

## Dataset

Daily station-wise cloud cover for ~1,245 IMD stations, published to
[`data/`](data) as Parquet and CSV. It is model **day-0 forecast**, not
observation. For column definitions, coverage and caveats, see
[`data/DATA.md`](data/DATA.md).

## License

The code is licensed under MIT. The data is available under ODbL.

## AI Declaration

Components of this repository, including code and documentation, were written
with assistance from Claude AI.
