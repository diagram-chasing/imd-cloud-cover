// Seasonal-lens computations (spec A9). All derived client-side from the core
// static views — no extra pipeline output.
import type { StationsManifest, AllStations, Rollup } from '$lib/types';
import { CLOUDY_DAY } from '$lib/theme';

export type LensMode = 'monsoon' | 'fog' | 'afternoon' | 'retreat';

export function lensMode(month: number): LensMode {
	// month is 1-12.
	if (month >= 6 && month <= 9) return 'monsoon';
	if (month === 10) return 'retreat';
	if (month === 11 || month === 12 || month <= 2) return 'fog';
	return 'afternoon'; // Mar-May
}

export const LENS_TITLE: Record<LensMode, string> = {
	monsoon: 'MONSOON WATCH',
	retreat: 'MONSOON RETREAT',
	fog: 'THE FOG BELT',
	afternoon: 'AFTERNOON BUILD-UP'
};

const FOG_STATES = new Set([
	'Punjab',
	'Haryana',
	'Delhi',
	'Uttar Pradesh',
	'Bihar',
	'West Bengal'
]);

function lowDailyMean(bands: { l: number[] }): number {
	return bands.l.reduce((a, b) => a + b, 0) / bands.l.length;
}

/** Northernmost station per 1° longitude bin whose low daily mean >= threshold. */
export function monsoonFront(
	manifest: StationsManifest,
	lowMeanByCode: Record<string, number>,
	threshold = CLOUDY_DAY
): { points: { lon: number; lat: number }[]; medianLat: number } {
	const bins = new Map<number, { lon: number; lat: number }>();
	for (const [code, s] of Object.entries(manifest.stations)) {
		const lm = lowMeanByCode[code];
		if (lm === undefined || lm < threshold) continue;
		const bin = Math.round(s.lon);
		const cur = bins.get(bin);
		if (!cur || s.lat > cur.lat) bins.set(bin, { lon: s.lon, lat: s.lat });
	}
	const points = [...bins.values()].sort((a, b) => a.lon - b.lon);
	const lats = points.map((p) => p.lat).sort((a, b) => a - b);
	const medianLat = lats.length ? lats[Math.floor(lats.length / 2)] : 0;
	return { points, medianLat };
}

/** Low daily mean per station from the latest 8-step slice. */
export function lowMeansFromLatest(latest: AllStations): Record<string, number> {
	const out: Record<string, number> = {};
	for (const [code, b] of Object.entries(latest.stations)) out[code] = lowDailyMean(b);
	return out;
}

/** Low daily mean per station from a specific day index of a rollup. */
export function lowMeansFromRollup(rollup: Rollup, dayIndex: number): Record<string, number> {
	const out: Record<string, number> = {};
	for (const [code, s] of Object.entries(rollup.stations)) {
		const v = s.l[dayIndex];
		if (v !== null) out[code] = v;
	}
	return out;
}

/** Fog belt: % of Indo-Gangetic stations foggy (low >= 60) at the 06:00 step. */
export function fogBelt(
	manifest: StationsManifest,
	latest: AllStations
): { pct: number; count: number; total: number; sparkline: number[] } {
	let foggy = 0;
	let total = 0;
	for (const [code, s] of Object.entries(manifest.stations)) {
		if (!s.state || !FOG_STATES.has(s.state)) continue;
		const b = latest.stations[code];
		if (!b) continue;
		total++;
		if ((b.l[2] ?? 0) >= CLOUDY_DAY) foggy++;
	}
	return { pct: total ? Math.round((foggy / total) * 100) : 0, count: foggy, total, sparkline: [] };
}

/** 7-day fog-belt sparkline: mean low of fog-belt stations per rollup day. */
export function fogSparkline(manifest: StationsManifest, rollup: Rollup): number[] {
	const codes = Object.entries(manifest.stations)
		.filter(([, s]) => s.state && FOG_STATES.has(s.state))
		.map(([c]) => c);
	return rollup.dates.map((_, i) => {
		const vals: number[] = [];
		for (const c of codes) {
			const v = rollup.stations[c]?.l[i];
			if (v !== null && v !== undefined) vals.push(v);
		}
		return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
	});
}

/** Afternoon build-up: national low+mid mean growth from 09:00 to 15:00. */
export function afternoonBuildup(latest: AllStations): { delta: number; at09: number; at15: number } {
	const codes = Object.keys(latest.stations);
	if (!codes.length) return { delta: 0, at09: 0, at15: 0 };
	const meanAt = (i: number) =>
		Math.round(
			codes.reduce((a, c) => {
				const b = latest.stations[c];
				return a + ((b.l[i] ?? 0) + (b.m[i] ?? 0)) / 2;
			}, 0) / codes.length
		);
	const at09 = meanAt(3);
	const at15 = meanAt(5);
	return { delta: at15 - at09, at09, at15 };
}
