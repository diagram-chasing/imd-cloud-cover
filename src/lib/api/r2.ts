// Fetch helpers for the pipeline's static JSON.
//
// Core views (manifest, latest, summary, rollups) AND the per-station tail
// (history/{code}.json plus the latest date's forecast) are baked into the deploy
// by scripts/bake-data.mjs and served same-origin from /baked — the daily workflow
// rebuilds the site after each scrape, so they're exactly as fresh as the data and
// a station page renders without touching the Worker. The tail fetches fall back to
// the remote endpoint (VITE_R2_PUBLIC_URL, a Worker over R2) for anything unbaked
// (dev --core-only builds, older dates). Only meta/dates.json and the raw meteogram
// .webp click-through links stay remote. With no endpoint configured, everything
// falls back to the committed /sample fixtures so a fresh clone still runs.
import type {
	StationsManifest,
	AllStations,
	Summary,
	Rollup,
	History,
	Forecast,
	DatesIndex
} from '$lib/types';

const REMOTE = (import.meta.env.VITE_R2_PUBLIC_URL || '').replace(/\/$/, '');
const BASE = REMOTE || '/sample';
const CORE = REMOTE ? '/baked' : '/sample';

/** Cache-buster for the daily-changing views, stable within an hour. */
function versionTag(): string {
	const now = new Date();
	return `${now.getUTCFullYear()}${now.getUTCMonth() + 1}${now.getUTCDate()}${now.getUTCHours()}`;
}

async function getJSON<T>(base: string, path: string, opts?: RequestInit): Promise<T> {
	const res = await fetch(`${base}/${path}`, opts);
	if (!res.ok) throw new Error(`Fetch failed: ${path} (${res.status})`);
	return res.json() as Promise<T>;
}

/** Freshest-view fetch for remote daily-changing files: bust CDN cache and revalidate. */
function getLatest<T>(path: string): Promise<T> {
	return getJSON<T>(BASE, `${path}?v=${versionTag()}`, { cache: 'no-cache' });
}

/** Tail fetch: prefer the baked copy (/baked), fall back to the remote endpoint. */
async function getTail<T>(path: string): Promise<T> {
	try {
		return await getJSON<T>(CORE, path);
	} catch (e) {
		if (BASE === CORE) throw e; // sample mode: no distinct remote to retry
		return getJSON<T>(BASE, path);
	}
}

// Baked views: deployed with the site, so plain same-origin fetches (the
// homepage preloads these exact URLs — keep them query-free).
export const fetchStations = () => getJSON<StationsManifest>(CORE, 'meta/stations.json');
export const fetchLatest = () => getJSON<AllStations>(CORE, 'latest/all-stations.json');
export const fetchSummary = () => getJSON<Summary>(CORE, 'latest/summary.json');
export const fetchRollup = (window: '7d' | '30d') =>
	getJSON<Rollup>(CORE, `rollups/${window}.json`);

// Per-station tail: baked into /baked, remote fallback for anything unbaked.
export const fetchHistory = (code: string) => getTail<History>(`history/${code}.json`);
export const fetchForecast = (date: string, code: string) =>
	getTail<Forecast>(`${date}/${code}-meteogram.json`);

// Remote, on-demand.
export const fetchDates = () => getLatest<DatesIndex>('meta/dates.json');

/** URL of a raw meteogram image (for the method note / station links). */
export const meteogramImageUrl = (date: string, code: string) =>
	`${BASE}/${date}/${code}-meteogram.webp`;

export { BASE as R2_BASE, CORE as CORE_BASE };
