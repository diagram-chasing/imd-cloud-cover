#!/usr/bin/env bash
# Build the static map data served from /data for the pixel sky-map.
# Sources live in src/lib/assets (Natural Earth shapefiles + a states GeoJSON).
# The raw Natural Earth folders (ne_*) are NOT committed — download and unzip them
# from https://www.naturalearthdata.com/downloads/ before running:
#   - ne_10m_urban_areas
#   - ne_50m_rivers_lake_centerlines_scale_rank
# Populated places now come from GeoNames (src/lib/assets/IN.zip); see build-places.mjs.
# Requires: mapshaper, ogr2ogr (GDAL). Run from repo root: bash scripts/build-map-data.sh
set -euo pipefail

ASSETS="src/lib/assets"
OUT="src/lib/assets/geo"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"

echo "0/3  sanitising states source (drop NaN / empty geometries)"
# The raw map.json ships several J&K sub-features whose coordinates are NaN or
# collapsed to a point. d3 silently skips them, but mapshaper encodes them into
# a globe-spanning arc that wrecks the projection fit. Strip them up front.
node -e '
  const fs = require("fs");
  const { geoBounds, geoArea } = require("d3-geo");
  const fc = JSON.parse(fs.readFileSync("'"$ASSETS"'/map.json"));
  const good = fc.features.filter((f) => {
    if (!f.geometry) return false;
    const b = geoBounds(f);
    if (!b.flat().every(Number.isFinite)) return false; // NaN coords
    return geoArea(f) > 0; // drop zero-area slivers
  });
  const dropped = fc.features.length - good.length;
  fc.features = good;
  fs.writeFileSync("'"$TMP"'/states.geojson", JSON.stringify(fc));
  console.error(`     kept ${good.length}, dropped ${dropped} degenerate features`);
'

echo "1/3  states -> $OUT/india.json (simplified topojson)"
# NOTE: no topojson `quantization` here. On this J&K geometry, quantization
# collapses a boundary arc into a globe-spanning ring that destroys the
# projection fit; -clean alone can't undo it. -simplify keeps the file small.
mapshaper "$TMP/states.geojson" \
  -simplify 12% keep-shapes \
  -clean \
  -o format=topojson "$OUT/india.json"

echo "2/3  urban areas clipped to India -> $OUT/india-urban.json"
# Natural Earth urban polygons are global; clip them to the India outline so we
# only render built-up land inside the country, then simplify for size.
mapshaper "$ASSETS/ne_10m_urban_areas/ne_10m_urban_areas.shp" \
  -clip "$TMP/states.geojson" \
  -simplify 20% keep-shapes \
  -clean \
  -o format=topojson "$OUT/india-urban.json"

echo "3/4  major rivers clipped to India -> $OUT/india-rivers.json"
# Natural Earth river centerlines are global and ranked (scalerank: lower = more
# major). Keep only the big rivers, clip to India, simplify for size.
mapshaper "$ASSETS/ne_50m_rivers_lake_centerlines_scale_rank/ne_50m_rivers_lake_centerlines_scale_rank.shp" \
  -filter 'scalerank <= 6' \
  -clip "$TMP/states.geojson" \
  -simplify 20% keep-shapes \
  -clean \
  -o format=topojson "$OUT/india-rivers.json"

echo "4/4  populated places (GeoNames India) -> $OUT/india-places.json"
# A denser label + search set, derived from GeoNames (src/lib/assets/IN.zip) with
# each place linked to its nearest IMD station. See scripts/build-places.mjs.
node scripts/build-places.mjs

echo "done:"
ls -lh "$OUT"/india.json "$OUT"/india-urban.json "$OUT"/india-rivers.json "$OUT"/india-places.json
