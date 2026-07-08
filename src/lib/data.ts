// Derive the per-station cover map from the current view.
import type { AllStations, BandValues, Rollup, ViewMode } from '$lib/types';

export function rollupForView(
	view: ViewMode,
	rollup7: Rollup | undefined,
	rollup30: Rollup | undefined
): Rollup | undefined {
	if (view === 'week') return rollup7;
	if (view === 'month') return rollup30;
	return undefined;
}

/** Per-station {h,m,l} at the current step (today) or window day (week/month). */
export function computeValues(
	view: ViewMode,
	latest: AllStations | undefined,
	rollup: Rollup | undefined,
	timeIndex: number,
	windowDayIndex: number
): BandValues {
	const out: BandValues = {};
	if (view === 'today') {
		if (!latest) return out;
		for (const [code, b] of Object.entries(latest.stations)) {
			out[code] = { h: b.h[timeIndex] ?? 0, m: b.m[timeIndex] ?? 0, l: b.l[timeIndex] ?? 0, p: b.p?.[timeIndex] ?? 0 };
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
