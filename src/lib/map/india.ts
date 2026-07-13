// India basemap, decoded once and shared across every place page. Bundling the
// topojson (one cached JS chunk) instead of fetching it at runtime keeps the
// map from popping in after hydration.
import type { Topology } from 'topojson-specification';
import india from '$lib/assets/geo/india.json';
import { topoToFeatures } from './geo';

export const indiaFeatures = topoToFeatures(india as unknown as Topology);
