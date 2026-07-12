// City pages are prerendered so crawlers get per-city <meta> og: tags and the
// header ships as real HTML. The interactive sections (today card, map, forecast)
// hydrate client-side like the rest of the app. Data is read from the build-baked
// JSON (static/baked), falling back to the committed sample fixtures.
import type { EntryGenerator, PageServerLoad } from './$types';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { error } from '@sveltejs/kit';
import type { FeatureCollection, Point } from 'geojson';
import type { CitiesRollup, StationsManifest, Summary } from '$lib/types';
import { citySlugs } from '$lib/city/slug.js';
import { haversineKm } from '$lib/city/distance';

export const prerender = true;

const RADIUS_KM = 100;
const MAP_CAP = 12;

// Prefer the build-baked view, fall back to the sample fixture — mirrors the
// CORE/BASE split in src/lib/api/r2.ts so dev/`pnpm check` work without a data endpoint.
function readView<T>(rel: string): T {
	for (const dir of ['static/baked', 'static/sample']) {
		const p = resolve(dir, rel);
		if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8')) as T;
	}
	throw new Error(`city page: missing data view ${rel} (baked & sample)`);
}

function loadData() {
	const cities = readView<CitiesRollup>('rollups/cities.json');
	const summary = readView<Summary>('latest/summary.json');
	const manifest = readView<StationsManifest>('meta/stations.json');
	const places = JSON.parse(
		readFileSync(resolve('src/lib/assets/geo/india-places.json'), 'utf8')
	) as FeatureCollection;
	return { cities, summary, manifest, places };
}

export const entries: EntryGenerator = () => {
	const { cities } = loadData();
	const { codeBySlug } = citySlugs(cities.cities);
	return Object.keys(codeBySlug).map((slug) => ({ slug }));
};

export const load: PageServerLoad = ({ params }) => {
	const { cities, summary, manifest, places } = loadData();
	const { codeBySlug } = citySlugs(cities.cities);
	const code = codeBySlug[params.slug];
	if (!code) throw error(404, 'Unknown city');
	const city = cities.cities[code];

	// City coordinates: the india-places feature that names this city and points
	// at this station wins; else the biggest place pointing here; else the
	// station's own coordinates.
	let lat: number | null = null;
	let lon: number | null = null;
	let bestScore = -1;
	for (const f of places.features) {
		const p = f.properties as { nearest?: string; name?: string; pop?: number } | null;
		if (!p || p.nearest !== code || f.geometry?.type !== 'Point') continue;
		const score = p.name === city.name ? Infinity : (p.pop ?? 0);
		if (score > bestScore) {
			bestScore = score;
			[lon, lat] = (f.geometry as Point).coordinates as [number, number];
		}
	}
	const own = manifest.stations[code];
	if (lat === null && own) {
		lat = own.lat;
		lon = own.lon;
	}

	// Stations near the city: the city's own station is always included (flagged
	// primary), the rest within RADIUS_KM, nearest first.
	const scored = Object.entries(manifest.stations).map(([c, s]) => ({
		code: c,
		name: s.name,
		state: s.state,
		lat: s.lat,
		lon: s.lon,
		km: lat === null ? Infinity : Math.round(haversineKm(lat, lon as number, s.lat, s.lon)),
		primary: c === code
	}));
	const nearby = scored
		.filter((s) => s.primary || s.km <= RADIUS_KM)
		.sort((a, b) => a.km - b.km);
	// Plot the nearest MAP_CAP; the header count reports exactly what's plotted so
	// the two never disagree.
	const stations = nearby.slice(0, MAP_CAP);
	const stationCount = stations.length;
	const primaryKm = stations.find((s) => s.primary)?.km ?? null;

	const stateLabel = city.state ? `, ${city.state}` : '';
	const og = {
		title: `${city.name}${stateLabel} — Mapping India's Clouds`,
		description: `${city.name}${stateLabel}: daily cloud cover read from IMD meteograms, across ${stationCount} station${stationCount === 1 ? '' : 's'} nearby.`
	};

	return {
		slug: params.slug,
		code,
		name: city.name,
		state: city.state,
		pop: city.pop,
		tier: city.tier,
		lat,
		lon,
		date: summary.date,
		stationName: own?.name ?? city.name,
		primaryKm,
		stationCount,
		stations,
		og
	};
};
