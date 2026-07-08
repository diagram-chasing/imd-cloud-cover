// One-shot loader for the core static views used across pages.
import type { Topology } from 'topojson-specification';
import type { FeatureCollection } from 'geojson';
import type { StationsManifest, AllStations, Summary, Rollup } from '$lib/types';
import { fetchStations, fetchLatest, fetchSummary, fetchRollup } from './r2';
import { topoToIndia } from '$lib/map/projection';

export interface CoreData {
	india: FeatureCollection;
	/** A limited set of major cities, as labelled points. */
	places: FeatureCollection;
	manifest: StationsManifest;
	latest: AllStations;
	summary: Summary;
	rollup7: Rollup;
	rollup30: Rollup;
}

export async function loadCore(): Promise<CoreData> {
	const [topo, places, manifest, latest, summary, rollup7, rollup30] = await Promise.all([
		fetch('/data/india.json').then((r) => r.json() as Promise<Topology>),
		fetch('/data/india-places.json').then((r) => r.json() as Promise<FeatureCollection>),
		fetchStations(),
		fetchLatest(),
		fetchSummary(),
		fetchRollup('7d'),
		fetchRollup('30d')
	]);
	return {
		india: topoToIndia(topo),
		places,
		manifest,
		latest,
		summary,
		rollup7,
		rollup30
	};
}
