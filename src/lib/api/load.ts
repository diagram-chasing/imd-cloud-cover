// Loaders for the static views, split so the homepage's first paint is gated on
// the smallest possible set. The CRITICAL views (india outline, station manifest,
// today's readings, summary) are all the "today" map needs — ~300 KB. They're
// fetched in +page.ts's load(), so on the prerendered homepage they're serialized
// into the page and present at hydration with no client round-trip.
//
// The DEFERRED views (place labels, week/month rollups) are heavy (~1.5 MB) and
// only used once the user zooms in or switches to Week/Month — so they load in the
// background after first paint instead of blocking it.
import type { Topology } from 'topojson-specification';
import type { FeatureCollection } from 'geojson';
import type { StationsManifest, AllStations, Summary, Rollup } from '$lib/types';
import { CORE_BASE } from './r2';
// Basemap outline + place labels never change between basemap rebuilds, so import
// them as content-hashed assets (served `immutable`, cached forever) rather than
// from static/ (revalidated every visit). The URL is base-aware automatically.
import indiaUrl from '$lib/assets/geo/india.json?url';
import placesUrl from '$lib/assets/geo/india-places.json?url';

type Fetch = typeof fetch;

async function json<T>(f: Fetch, url: string): Promise<T> {
	const res = await f(url);
	if (!res.ok) throw new Error(`Fetch failed: ${url} (${res.status})`);
	return res.json() as Promise<T>;
}

/** The minimum the "today" map needs. `topo` is the raw topojson (smaller to
 *  serialize into the prerendered page than the expanded FeatureCollection);
 *  the page turns it into `india` via topoToFeatures once, on the client. */
export interface CriticalData {
	topo: Topology;
	manifest: StationsManifest;
	latest: AllStations;
	summary: Summary;
}

export function loadCritical(f: Fetch = fetch): Promise<CriticalData> {
	return Promise.all([
		json<Topology>(f, indiaUrl),
		json<StationsManifest>(f, `${CORE_BASE}/meta/stations.json`),
		json<AllStations>(f, `${CORE_BASE}/latest/all-stations.json`),
		json<Summary>(f, `${CORE_BASE}/latest/summary.json`)
	]).then(([topo, manifest, latest, summary]) => ({ topo, manifest, latest, summary }));
}

/** Heavy views not needed for first paint: place labels (only shown when zoomed
 *  in) and the week/month rollups (only used by those tabs). */
export interface DeferredData {
	places: FeatureCollection;
	rollup7: Rollup;
	rollup30: Rollup;
}

export function loadDeferred(f: Fetch = fetch): Promise<DeferredData> {
	return Promise.all([
		json<FeatureCollection>(f, placesUrl),
		json<Rollup>(f, `${CORE_BASE}/rollups/7d.json`),
		json<Rollup>(f, `${CORE_BASE}/rollups/30d.json`)
	]).then(([places, rollup7, rollup30]) => ({ places, rollup7, rollup30 }));
}
