// prerendered; city-backed stations 308-redirect to /city/[slug] at build time
import type { EntryGenerator, PageServerLoad } from './$types';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { error, redirect } from '@sveltejs/kit';
import { base } from '$app/paths';
import type { CitiesRollup, StationsManifest, Summary } from '$lib/types';
import { citySlugs } from '$lib/city/slug.js';
import { haversineKm } from '$lib/city/distance';

export const prerender = true;

// map labels only cities that land inside the crop window
const CITY_RADIUS_KM = 220;
const CITY_CAP = 12;

// prefer baked view, fall back to sample fixture
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
	// tolerate exact or upper-cased code in URL
	const code = manifest.stations[params.code] ? params.code : params.code.toUpperCase();

	// city-backed station: redirect to canonical city page
	const slug = citySlugs(cities.cities).slugByCode[code];
	if (slug) throw redirect(308, `${base}/city/${slug}`);

	const station = manifest.stations[code];
	if (!station) throw error(404, `Unknown station ${code}`);

	// adjoining cities: nearest within radius; map decides which land inside the frame
	const nearbyCities = Object.entries(cities.cities)
		.filter(([c]) => c !== code && manifest.stations[c])
		.map(([c, city]) => {
			const s = manifest.stations[c];
			return {
				name: city.name,
				lat: s.lat,
				lon: s.lon,
				km: Math.round(haversineKm(station.lat, station.lon, s.lat, s.lon))
			};
		})
		.filter((c) => c.km <= CITY_RADIUS_KM)
		.sort((a, b) => a.km - b.km)
		.slice(0, CITY_CAP)
		.map(({ name, lat, lon }) => ({ name, lat, lon }));

	return {
		code,
		name: station.name,
		state: station.state ?? null,
		lat: station.lat,
		lon: station.lon,
		date: summary.date,
		cities: nearbyCities
	};
};
