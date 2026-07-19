// Build-time data-view reader (server only). Prefers the freshly-baked view,
// falls back to the sample fixture so a clean clone still prerenders.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AllStations } from '$lib/types';
import { normalizeStationsManifest, normalizeCities } from '$lib/stations/labels';

const DIRS = ['static/baked', 'static/sample'];

function find(rel: string): string | null {
	for (const dir of DIRS) {
		const p = resolve(dir, rel);
		if (existsSync(p)) return p;
	}
	return null;
}

// Repair display names/state strings on the way out, once, for every reader.
function normalize<T>(rel: string, view: T): T {
	if (rel === 'meta/stations.json') return normalizeStationsManifest(view as never) as T;
	if (rel === 'rollups/cities.json') return normalizeCities(view as never) as T;
	return view;
}

/** Read a required view; throws if absent in both baked and sample. */
export function readView<T>(rel: string): T {
	const p = find(rel);
	if (!p) throw new Error(`missing data view ${rel} (baked & sample)`);
	return normalize(rel, JSON.parse(readFileSync(p, 'utf8')) as T);
}

/** Read an optional view; returns null if absent (e.g. unbaked tail files). */
export function readViewOpt<T>(rel: string): T | null {
	const p = find(rel);
	return p ? normalize(rel, JSON.parse(readFileSync(p, 'utf8')) as T) : null;
}

/** Narrow the national `latest` view to just `codes`. The reading card + map
 *  only ever read the plotted stations, so a page ships its handful of nearby
 *  bands (~KBs) instead of the full national blob (~300 KB). */
export function miniLatest(all: AllStations, codes: string[]): AllStations {
	const stations: AllStations['stations'] = {};
	const forecast: NonNullable<AllStations['forecast']> = {};
	for (const c of codes) {
		if (all.stations[c]) stations[c] = all.stations[c];
		if (all.forecast?.[c]) forecast[c] = all.forecast[c];
	}
	return {
		date: all.date,
		generated_at: all.generated_at,
		steps: all.steps,
		stations,
		fdays: all.fdays,
		forecast
	};
}
