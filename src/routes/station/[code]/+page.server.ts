// Station pages are prerendered. City-backed stations redirect to their canonical
// /city/[slug] page at build time (no client round-trip); the rest ship as real
// HTML with the station's identity baked in, so the header renders instantly. Only
// today's readings (latest) and the forecast load client-side.
import type { EntryGenerator, PageServerLoad } from './$types';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { error, redirect } from '@sveltejs/kit';
import { base } from '$app/paths';
import type { CitiesRollup, StationsManifest, Summary } from '$lib/types';
import { citySlugs } from '$lib/city/slug.js';

export const prerender = true;

// Prefer the build-baked view, fall back to the sample fixture — mirrors the
// CORE/BASE split in src/lib/api/r2.ts and the city page's loader.
function readView<T>(rel: string): T {
	for (const dir of ['static/baked', 'static/sample']) {
		const p = resolve(dir, rel);
		if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8')) as T;
	}
	throw new Error(`station page: missing data view ${rel} (baked & sample)`);
}

function loadData() {
	return {
		cities: readView<CitiesRollup>('rollups/cities.json'),
		summary: readView<Summary>('latest/summary.json'),
		manifest: readView<StationsManifest>('meta/stations.json')
	};
}

export const entries: EntryGenerator = () => {
	const { manifest } = loadData();
	return Object.keys(manifest.stations).map((code) => ({ code }));
};

export const load: PageServerLoad = ({ params }) => {
	const { cities, summary, manifest } = loadData();
	// Tolerate either exact or upper-cased code in the URL.
	const code = manifest.stations[params.code] ? params.code : params.code.toUpperCase();

	// If this station backs a city, its canonical home is the city page.
	const slug = citySlugs(cities.cities).slugByCode[code];
	if (slug) throw redirect(308, `${base}/city/${slug}`);

	const station = manifest.stations[code];
	if (!station) throw error(404, `Unknown station ${code}`);

	return {
		code,
		name: station.name,
		state: station.state ?? null,
		lat: station.lat,
		lon: station.lon,
		date: summary.date
	};
};
