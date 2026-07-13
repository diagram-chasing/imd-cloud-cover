// Core views are baked into /baked (same-origin, fresh after each scrape).
// Tail fetches (history, forecast) fall back to the remote Worker for anything unbaked.
// No endpoint configured -> /sample fixtures so a fresh clone still runs.
import { base } from '$app/paths';
import type {
	StationsManifest,
	AllStations,
	Summary,
	CitiesRollup,
	History,
	Forecast
} from '$lib/types';

const REMOTE = (import.meta.env.VITE_R2_PUBLIC_URL || '').replace(/\/$/, '');
// local views live under `base` (site is a subpath); REMOTE is absolute
const BASE = REMOTE || `${base}/sample`;
const CORE = REMOTE ? `${base}/baked` : `${base}/sample`;

async function getJSON<T>(base: string, path: string, opts?: RequestInit): Promise<T> {
	const res = await fetch(`${base}/${path}`, opts);
	if (!res.ok) throw new Error(`Fetch failed: ${path} (${res.status})`);
	return res.json() as Promise<T>;
}

/** prefer baked copy, fall back to remote */
async function getTail<T>(path: string): Promise<T> {
	try {
		return await getJSON<T>(CORE, path);
	} catch (e) {
		if (BASE === CORE) throw e; // sample mode: no distinct remote to retry
		return getJSON<T>(BASE, path);
	}
}

// homepage preloads these exact URLs - keep them query-free
export const fetchStations = () => getJSON<StationsManifest>(CORE, 'meta/stations.json');
export const fetchLatest = () => getJSON<AllStations>(CORE, 'latest/all-stations.json');
export const fetchSummary = () => getJSON<Summary>(CORE, 'latest/summary.json');

export const fetchCities = () => getJSON<CitiesRollup>(CORE, 'rollups/cities.json');

// per-station tail: baked, remote fallback for anything unbaked
export const fetchHistory = (code: string) => getTail<History>(`history/${code}.json`);
export const fetchForecast = (date: string, code: string) =>
	getTail<Forecast>(`${date}/${code}-meteogram.json`);

/** IP-based city-level location from Cloudflare edge. Null in sample mode or when unresolvable. */
export interface GeoHint {
	city: string | null;
	region: string | null;
	country: string | null;
	lat: number;
	lng: number;
}
export async function fetchGeo(): Promise<GeoHint | null> {
	if (!REMOTE) return null;
	const res = await fetch(`${REMOTE}/geo`, { cache: 'no-store' });
	if (!res.ok) return null;
	const d = (await res.json()) as Partial<GeoHint>;
	if (typeof d.lat !== 'number' || typeof d.lng !== 'number') return null;
	return {
		city: d.city ?? null,
		region: d.region ?? null,
		country: d.country ?? null,
		lat: d.lat,
		lng: d.lng
	};
}

/** URL of a raw meteogram image. */
export const meteogramImageUrl = (date: string, code: string) =>
	`${BASE}/${date}/${code}-meteogram.webp`;

export { BASE as R2_BASE, CORE as CORE_BASE };
