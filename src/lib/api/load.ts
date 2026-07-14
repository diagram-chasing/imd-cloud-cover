// critical views (~300 KB) gate first paint; deferred views (~1.5 MB) load after
import type { Topology } from 'topojson-specification';
import type { StationsManifest, AllStations, Summary, Rollup } from '$lib/types';
import { CORE_BASE } from './r2';
// content-hashed assets: immutable cache, base-aware URL
import indiaUrl from '$lib/assets/geo/india.json?url';

type Fetch = typeof fetch;

async function json<T>(f: Fetch, url: string): Promise<T> {
	const res = await f(url);
	if (!res.ok) throw new Error(`Fetch failed: ${url} (${res.status})`);
	return res.json() as Promise<T>;
}

/** raw topojson (smaller to serialize into prerendered HTML than FeatureCollection) */
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

/** week/month rollups - not needed for first paint. Place labels are derived from
 *  the (critical) manifest via `$lib/places`, so no separate gazetteer is fetched. */
export interface DeferredData {
	rollup7: Rollup;
	rollup30: Rollup;
}

export function loadDeferred(f: Fetch = fetch): Promise<DeferredData> {
	return Promise.all([
		json<Rollup>(f, `${CORE_BASE}/rollups/7d.json`),
		json<Rollup>(f, `${CORE_BASE}/rollups/30d.json`)
	]).then(([rollup7, rollup30]) => ({ rollup7, rollup30 }));
}
