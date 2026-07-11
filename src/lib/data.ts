// Derive the per-station cover map from the current view.
import type { AllStations, BandValues, Rollup, StationBands, ViewMode } from '$lib/types';

const DAY_STEPS = 8;

/** Today's date in IST (UTC+5:30) as YYYY-MM-DD. The map/summary are keyed to
 *  IST days, so "current" must be measured there, not in the visitor's zone. */
export function istDateString(now: number = Date.now()): string {
	return new Date(now + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Every day the latest view can render, ascending: day-0 followed by fdays. */
export function forecastDays(latest: AllStations): string[] {
	return [latest.date, ...(latest.fdays ?? [])];
}

/** Which day of the latest view to show for the visitor's current IST date.
 *  Returns the matching day, or the nearest end of the window if the current
 *  date falls outside it (before day-0, or past the forecast horizon). */
export function resolveActiveDay(
	latest: AllStations,
	now: number = Date.now()
): { date: string; index: number } {
	const days = forecastDays(latest);
	const today = istDateString(now);
	let index = days.indexOf(today);
	if (index < 0) index = today < days[0] ? 0 : days.length - 1;
	return { date: days[index], index };
}

/** The 8-step bands for a station on day `index` of the latest view (0 = day-0).
 *  Falls back to day-0 when the forecast tail is missing or too short. */
export function dayBands(latest: AllStations, code: string, index: number): StationBands | null {
	const day0 = latest.stations[code] ?? null;
	if (index <= 0) return day0;
	const f = latest.forecast?.[code];
	if (!f) return day0;
	const off = (index - 1) * DAY_STEPS;
	const cut = (a?: number[]) => a?.slice(off, off + DAY_STEPS) ?? [];
	const bands = { h: cut(f.h), m: cut(f.m), l: cut(f.l), p: cut(f.p) };
	return bands.h.length === DAY_STEPS ? bands : day0;
}

/** The whole station map re-sliced to day `index` (day-0 returns the original). */
export function stationsForDay(latest: AllStations, index: number): Record<string, StationBands> {
	if (index <= 0 || !latest.forecast) return latest.stations;
	const out: Record<string, StationBands> = {};
	for (const code of Object.keys(latest.stations)) {
		out[code] = dayBands(latest, code, index) ?? latest.stations[code];
	}
	return out;
}

export function rollupForView(
	view: ViewMode,
	rollup7: Rollup | undefined,
	rollup30: Rollup | undefined
): Rollup | undefined {
	if (view === 'week') return rollup7;
	if (view === 'month') return rollup30;
	return undefined;
}

/** Per-station {h,m,l} at the current step (today) or window day (week/month).
 *  In today view, `dayIndex` picks which forecast day of `latest` to read so the
 *  map can show the visitor's current IST day, not just the day-0 scrape. */
export function computeValues(
	view: ViewMode,
	latest: AllStations | undefined,
	rollup: Rollup | undefined,
	timeIndex: number,
	windowDayIndex: number,
	dayIndex: number = 0
): BandValues {
	const out: BandValues = {};
	if (view === 'today') {
		if (!latest) return out;
		for (const [code, b] of Object.entries(stationsForDay(latest, dayIndex))) {
			out[code] = {
				h: b.h[timeIndex] ?? 0,
				m: b.m[timeIndex] ?? 0,
				l: b.l[timeIndex] ?? 0,
				p: b.p?.[timeIndex] ?? 0
			};
		}
		return out;
	}
	if (!rollup) return out;
	const i = Math.min(windowDayIndex, rollup.dates.length - 1);
	for (const [code, s] of Object.entries(rollup.stations)) {
		out[code] = { h: s.h[i] ?? 0, m: s.m[i] ?? 0, l: s.l[i] ?? 0, p: s.p?.[i] ?? 0 };
	}
	return out;
}
