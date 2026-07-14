// city pages fully prerendered: header, reading, map and forecast all baked so
// there is no client fetch (and no "NO READING" flash) on hydration.
import type { EntryGenerator, PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import type { AllStations, CitiesRollup, Forecast, StationsManifest, Summary } from '$lib/types';
import { citySlugs } from '$lib/stations/slug.js';
import { haversineKm } from '$lib/stations/distance';
import { titleCase } from '$lib/format';
import { readView, readViewOpt, miniLatest } from '$lib/server/views';

export const prerender = true;

const RADIUS_KM = 100;
const MAP_CAP = 12;

function loadData() {
	const cities = readView<CitiesRollup>('rollups/cities.json');
	const summary = readView<Summary>('latest/summary.json');
	const manifest = readView<StationsManifest>('meta/stations.json');
	const all = readView<AllStations>('latest/all-stations.json');
	return { cities, summary, manifest, all };
}

export const entries: EntryGenerator = () => {
	const { cities } = loadData();
	const { codeBySlug } = citySlugs(cities.cities);
	return Object.keys(codeBySlug).map((slug) => ({ slug }));
};

export const load: PageServerLoad = ({ params }) => {
	const { cities, summary, manifest, all } = loadData();
	const { codeBySlug } = citySlugs(cities.cities);
	const code = codeBySlug[params.slug];
	if (!code) throw error(404, 'Unknown station');
	const city = cities.cities[code];

	// Place = station: the page is the IMD station itself, so its coordinates are
	// the station's own — no GeoNames place lookup, no far/spurious offset.
	const own = manifest.stations[code];
	const lat: number | null = own ? own.lat : null;
	const lon: number | null = own ? own.lon : null;

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
	// Place = station, so the reading is the station's own (0 km); hide the distance.
	const primaryKm = stations.find((s) => s.primary)?.km || null;

	const sameName = city.district && city.district.toLowerCase() === city.name.toLowerCase();
	const place = titleCase(city.district && !sameName ? city.district : null);
	const region = [place, titleCase(city.state)].filter(Boolean).join(', ');
	const stateLabel = region ? `, ${region}` : '';
	const og = {
		title: `${city.name}${stateLabel} — Mapping India's Clouds`,
		description: `${city.name}${stateLabel}: daily cloud cover read from IMD meteograms, across ${stationCount} station${stationCount === 1 ? '' : 's'} nearby.`
	};

	// bake only what this page plots: the nearby-station bands (reading + map),
	// their lookup entries (tooltip) and the primary forecast.
	const codes = stations.map((s) => s.code);
	const latest = miniLatest(all, codes);
	const forecast = readViewOpt<Forecast>(`${summary.date}/${code}-meteogram.json`);
	const stationLookup = Object.fromEntries(
		codes.filter((c) => manifest.stations[c]).map((c) => [c, manifest.stations[c]])
	);
	const history = { dates: cities.dates, name: city.name, e: city.e };

	return {
		slug: params.slug,
		code,
		name: city.name,
		state: city.state,
		district: city.district ?? null,
		pop: city.pop,
		tier: city.tier,
		lat,
		lon,
		date: summary.date,
		stationName: own?.name ?? city.name,
		primaryKm,
		stationCount,
		stations,
		og,
		latest,
		forecast,
		stationLookup,
		history
	};
};
