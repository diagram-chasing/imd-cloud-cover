// Almanac facts for the station page, derived from the pipeline's static views.
// Everything here is a pure function of already-fetched JSON so the page stays
// a dumb renderer. Thresholds mirror theme.ts / aggregate.py.

import type { AllStations, StationBands, History, Rollup } from '$lib/types';
import { CLEAR_STARS, CLOUDY_DAY, RAIN_FLOOR } from '$lib/theme';

/** Step labels for the 8 three-hourly IST slots (00:00..21:00). */
export const STEP_LABELS = [
	'midnight',
	'3 am',
	'6 am',
	'9 am',
	'noon',
	'3 pm',
	'6 pm',
	'9 pm'
] as const;

export const STEP_TICKS = ['00', '03', '06', '09', '12', '15', '18', '21'] as const;

/** Effective cover per step (max of the three bands) plus its day shape. */
export interface DayShape {
	e: number[]; // 8 per-step effective values
	mean: number;
	clearestIdx: number;
	cloudiestIdx: number;
	/** evening (15-21) minus morning (06-12) mean; + = clouding over */
	trend: number;
}

export function dayShape(bands: StationBands): DayShape {
	const n = bands.h.length;
	const e = Array.from({ length: n }, (_, i) =>
		Math.max(bands.h[i] ?? 0, bands.m[i] ?? 0, bands.l[i] ?? 0)
	);
	const mean = Math.round(e.reduce((s, v) => s + v, 0) / n);
	let clearestIdx = 0;
	let cloudiestIdx = 0;
	for (let i = 1; i < n; i++) {
		if (e[i] < e[clearestIdx]) clearestIdx = i;
		if (e[i] > e[cloudiestIdx]) cloudiestIdx = i;
	}
	const morning = (e[2] + e[3] + e[4]) / 3; // 06:00-12:00
	const evening = (e[5] + e[6] + e[7]) / 3; // 15:00-21:00
	return { e, mean, clearestIdx, cloudiestIdx, trend: Math.round(evening - morning) };
}

/** The word the almanac uses for a daily effective mean. */
export function skyWord(mean: number): string {
	if (mean < CLEAR_STARS) return 'clear';
	if (mean < 50) return 'lightly veiled';
	if (mean < CLOUDY_DAY + 15) return 'cloudy';
	return 'overcast';
}

/** One calm editorial sentence for today. Deterministic; no AI prose. */
export function headline(shape: DayShape): string {
	const word = skyWord(shape.mean);
	if (shape.trend >= 20) return `A ${word} day, clouding over through the afternoon.`;
	if (shape.trend <= -20) return `A ${word} day, clearing towards evening.`;
	if (shape.mean < CLEAR_STARS) return 'A clear sky, start to finish.';
	if (shape.mean >= CLOUDY_DAY + 15) return 'Overcast from start to finish.';
	return `A ${word} day, holding steady.`;
}

/** Rank of this station among today's stations, 1 = clearest. */
export function rankToday(
	latest: AllStations,
	code: string
): { rank: number; of: number } | null {
	const mine = latest.stations[code];
	if (!mine) return null;
	const myMean = dayShape(mine).mean;
	let rank = 1;
	let of = 0;
	for (const [c, b] of Object.entries(latest.stations)) {
		of++;
		if (c !== code && dayShape(b).mean < myMean) rank++;
	}
	return { rank, of };
}

export function ordinal(n: number): string {
	const s = ['th', 'st', 'nd', 'rd'];
	const v = n % 100;
	return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

/** History days as a sorted [date, means] array, optionally only the last n calendar days. */
function historyDays(history: History, lastN?: number, latestDate?: string) {
	let entries = Object.entries(history.days).sort(([a], [b]) => (a < b ? -1 : 1));
	if (lastN && latestDate) {
		const cutoff = new Date(latestDate + 'T00:00:00Z');
		cutoff.setUTCDate(cutoff.getUTCDate() - (lastN - 1));
		const lo = cutoff.toISOString().slice(0, 10);
		entries = entries.filter(([d]) => d >= lo && d <= latestDate);
	}
	return entries;
}

/** Time-of-day climatology from the per-step `t` series in history. */
export interface TodClimo {
	mean: number[]; // 8 per-step means
	days: number; // how many days contributed
	cloudiestIdx: number;
	clearestIdx: number;
	spread: number; // cloudiest minus clearest step mean
}

export function todClimatology(
	history: History,
	lastN: number,
	latestDate: string
): TodClimo | null {
	const sums = new Array(8).fill(0);
	let days = 0;
	for (const [, dm] of historyDays(history, lastN, latestDate)) {
		if (!dm.t || dm.t.length !== 8) continue;
		for (let i = 0; i < 8; i++) sums[i] += dm.t[i];
		days++;
	}
	if (days === 0) return null;
	const mean = sums.map((s) => Math.round(s / days));
	let cloudiestIdx = 0;
	let clearestIdx = 0;
	for (let i = 1; i < 8; i++) {
		if (mean[i] > mean[cloudiestIdx]) cloudiestIdx = i;
		if (mean[i] < mean[clearestIdx]) clearestIdx = i;
	}
	return { mean, days, cloudiestIdx, clearestIdx, spread: mean[cloudiestIdx] - mean[clearestIdx] };
}

/** Clearest and cloudiest days on record (whole history file). */
export function records(history: History) {
	let clearest: { date: string; e: number } | null = null;
	let cloudiest: { date: string; e: number } | null = null;
	for (const [date, dm] of Object.entries(history.days)) {
		if (!clearest || dm.e < clearest.e) clearest = { date, e: dm.e };
		if (!cloudiest || dm.e > cloudiest.e) cloudiest = { date, e: dm.e };
	}
	return clearest && cloudiest ? { clearest, cloudiest } : null;
}

/** Days in the window whose daily precip signal clears the rain floor. */
export function rainDays(
	history: History,
	lastN: number,
	latestDate: string
): { rainy: number; of: number } {
	// Daily p is a mean of relative intensity, so it dilutes a wet afternoon;
	// half the per-step floor keeps "one real spell of rain" counting as a day.
	const floor = RAIN_FLOOR / 2;
	let rainy = 0;
	let of = 0;
	for (const [, dm] of historyDays(history, lastN, latestDate)) {
		of++;
		if (dm.p >= floor) rainy++;
	}
	return { rainy, of };
}

/** Longest run of consecutive-calendar clear days anywhere in the history. */
export function longestClearRun(history: History): number {
	let best = 0;
	let run = 0;
	let prev: string | null = null;
	for (const [date, dm] of historyDays(history)) {
		if (dm.e < CLEAR_STARS) {
			// A missing day between entries breaks the run.
			run = prev !== null && nextDay(prev) === date && run > 0 ? run + 1 : 1;
		} else {
			run = 0;
		}
		best = Math.max(best, run);
		prev = date;
	}
	return best;
}

function nextDay(iso: string): string {
	const d = new Date(iso + 'T00:00:00Z');
	d.setUTCDate(d.getUTCDate() + 1);
	return d.toISOString().slice(0, 10);
}

/** Today vs the station's own recent norm, in cover points. */
export function vsNorm(todayMean: number, rollup: Rollup, code: string): number | null {
	const series = rollup.stations[code]?.e;
	if (!series) return null;
	const vals = series.filter((v): v is number => v !== null);
	if (vals.length < 5) return null; // too little history to call a norm
	const norm = vals.reduce((s, v) => s + v, 0) / vals.length;
	return Math.round(todayMean - norm);
}

/** How often this station beat the national mean over the rollup window. */
export function vsNation(
	rollup: Rollup,
	code: string
): { clearerDays: number; of: number } | null {
	const mine = rollup.stations[code]?.e;
	const nat = rollup.national.e;
	if (!mine) return null;
	let clearerDays = 0;
	let of = 0;
	for (let i = 0; i < mine.length; i++) {
		const a = mine[i];
		const b = nat[i];
		if (a === null || b === null || b === undefined) continue;
		of++;
		if (a < b) clearerDays++;
	}
	return of > 0 ? { clearerDays, of } : null;
}

/** "July 6" from "2026-07-06" (no year — the almanac is about this season). */
export function shortDate(iso: string): string {
	const d = new Date(iso + 'T00:00:00Z');
	return d.toLocaleDateString('en-IN', { month: 'long', day: 'numeric', timeZone: 'UTC' });
}

export function longDate(iso: string): string {
	const d = new Date(iso + 'T00:00:00Z');
	return d.toLocaleDateString('en-IN', {
		weekday: 'long',
		month: 'long',
		day: 'numeric',
		year: 'numeric',
		timeZone: 'UTC'
	});
}
