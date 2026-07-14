// station pages fully prerendered: header, reading, map, forecast and history
// all baked so there is no client fetch (or "NO READING" flash) on hydration.
// city-backed stations 308-redirect to /stations/[slug] at build time.
import type { EntryGenerator, PageServerLoad } from './$types';
import { error, redirect } from '@sveltejs/kit';
import { base } from '$app/paths';
import type {
	AllStations,
	CitiesRollup,
	Forecast,
	History,
	StationsManifest,
	Summary
} from '$lib/types';
import { citySlugs } from '$lib/stations/slug.js';
import { haversineKm } from '$lib/stations/distance';
import { readView, readViewOpt, miniLatest } from '$lib/server/views';

export const prerender = true;

// nearby stations plotted on the map (clickable), nearest first — mirrors /stations/[slug]
const STATION_RADIUS_KM = 100;
const STATION_CAP = 12;

function loadData() {
	return {
		cities: readView<CitiesRollup>('rollups/cities.json'),
		summary: readView<Summary>('latest/summary.json'),
		manifest: readView<StationsManifest>('meta/stations.json'),
		all: readView<AllStations>('latest/all-stations.json')
	};
}

// walk a continuous calendar from first to last reading, leaving gaps null,
// matching the barcode strip's expectations.
function buildHistory(code: string, name: string) {
	const record = readViewOpt<History>(`history/${code}.json`);
	const days = record?.days;
	if (!days) return null;
	const keys = Object.keys(days).sort();
	if (!keys.length) return null;
	const dates: string[] = [];
	const e: (number | null)[] = [];
	const end = new Date(keys[keys.length - 1] + 'T00:00:00Z').getTime();
	for (let t = new Date(keys[0] + 'T00:00:00Z').getTime(); t <= end; t += 86_400_000) {
		const iso = new Date(t).toISOString().slice(0, 10);
		dates.push(iso);
		e.push(days[iso]?.e ?? null);
	}
	return { dates, name, e };
}

export const entries: EntryGenerator = () => {
	const { manifest } = loadData();
	return Object.keys(manifest.stations).map((code) => ({ code }));
};

export const load: PageServerLoad = ({ params }) => {
	const { cities, summary, manifest, all } = loadData();
	// tolerate exact or upper-cased code in URL
	const code = manifest.stations[params.code] ? params.code : params.code.toUpperCase();

	// city-backed station: redirect to canonical city page
	const { slugByCode } = citySlugs(cities.cities);
	if (slugByCode[code]) throw redirect(308, `${base}/stations/${slugByCode[code]}`);

	const station = manifest.stations[code];
	if (!station) throw error(404, `Unknown station ${code}`);

	// own station (primary) + nearby stations within radius, nearest first: all plotted
	// as clickable markers, exactly like the city page.
	const stations = Object.entries(manifest.stations)
		.map(([c, s]) => ({
			code: c,
			name: s.name,
			lat: s.lat,
			lon: s.lon,
			km: Math.round(haversineKm(station.lat, station.lon, s.lat, s.lon)),
			primary: c === code
		}))
		.filter((s) => s.primary || s.km <= STATION_RADIUS_KM)
		.sort((a, b) => a.km - b.km)
		.slice(0, STATION_CAP);

	// bake each plotted station's reading (map clouds + hover), plus this station's
	// forecast and history.
	const codes = stations.map((s) => s.code);
	const latest = miniLatest(all, codes);
	const forecast = readViewOpt<Forecast>(`${summary.date}/${code}-meteogram.json`);
	const stationLookup = Object.fromEntries(
		codes.filter((c) => manifest.stations[c]).map((c) => [c, manifest.stations[c]])
	);
	const history = buildHistory(code, station.name);

	return {
		code,
		name: station.name,
		state: station.state ?? null,
		district: station.district ?? null,
		lat: station.lat,
		lon: station.lon,
		date: summary.date,
		stationCount: stations.length,
		stations,
		latest,
		forecast,
		stationLookup,
		history
	};
};
