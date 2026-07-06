// Fetch helpers for the pipeline's static JSON. In production this points at the
// R2 public URL; in dev it falls back to the committed /sample fixtures.
import type {
	StationsManifest,
	AllStations,
	Summary,
	Rollup,
	History,
	Forecast,
	DatesIndex
} from '$lib/types';

const BASE = (import.meta.env.VITE_R2_PUBLIC_URL || '/sample').replace(/\/$/, '');

/** Cache-buster for the daily-changing views, stable within an hour. */
function versionTag(): string {
	const now = new Date();
	return `${now.getUTCFullYear()}${now.getUTCMonth() + 1}${now.getUTCDate()}${now.getUTCHours()}`;
}

async function getJSON<T>(path: string, opts?: RequestInit): Promise<T> {
	const res = await fetch(`${BASE}/${path}`, opts);
	if (!res.ok) throw new Error(`Fetch failed: ${path} (${res.status})`);
	return res.json() as Promise<T>;
}

/** Freshest-view fetch: bust CDN cache and revalidate. */
function getLatest<T>(path: string): Promise<T> {
	return getJSON<T>(`${path}?v=${versionTag()}`, { cache: 'no-cache' });
}

export const fetchStations = () => getJSON<StationsManifest>('meta/stations.json');
export const fetchDates = () => getLatest<DatesIndex>('meta/dates.json');
export const fetchLatest = () => getLatest<AllStations>('latest/all-stations.json');
export const fetchSummary = () => getLatest<Summary>('latest/summary.json');
export const fetchRollup = (window: '7d' | '30d') => getLatest<Rollup>(`rollups/${window}.json`);
export const fetchHistory = (code: string) => getJSON<History>(`history/${code}.json`);
export const fetchForecast = (date: string, code: string) =>
	getJSON<Forecast>(`${date}/${code}-meteogram.json`);

/** URL of a raw meteogram image (for the method note / station links). */
export const meteogramImageUrl = (date: string, code: string) =>
	`${BASE}/${date}/${code}-meteogram.webp`;

export { BASE as R2_BASE };
