// city pages prerendered: og tags + header baked; interactive sections hydrate client-side
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

// prefer baked view, fall back to sample fixture
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

	// city coords: named place wins, then biggest place pointing here, then station's own
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

	// own station always included (flagged primary); others within RADIUS_KM, nearest first
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
	// cap at MAP_CAP so header count matches what's plotted
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
