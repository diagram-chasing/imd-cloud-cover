// Display-derivation helpers: turn raw data/band values into UI strings.

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** ISO `YYYY-MM-DD` → `07 JUL 2026`; passes through anything unparseable. */
export function prettyDate(iso?: string): string {
	if (!iso) return '';
	const [y, m, d] = iso.split('-').map(Number);
	if (!y || !m || !d) return iso;
	return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
}

import { rainTier } from '$lib/theme';

function effectiveCover(v: { h: number; m: number; l: number }): number {
	return Math.max(v.l, v.m * 0.8, v.h * 0.45);
}

const RAIN_LABEL = ['', 'LIGHT RAIN', 'RAIN', 'HEAVY RAIN'];

/** Band values → sky-condition label (CLEAR … OVERCAST). Forecast rain, when
 *  the view carries it, overrides the cloud label — a raining "CLEAR" must
 *  never be shown. */
export function skyCondition(v: { h: number; m: number; l: number; r?: number } | null): string {
	if (!v) return '';
	const rt = rainTier(v.r);
	if (rt > 0) return RAIN_LABEL[rt];
	const c = effectiveCover(v);
	if (c < 13) return 'CLEAR';
	if (c < 38) return 'MOSTLY CLEAR';
	if (c < 63) return 'PARTLY CLOUDY';
	if (c < 88) return 'MOSTLY CLOUDY';
	return 'OVERCAST';
}

// --- Place labels (IMD strings are stored SHOUTY; fold to Title Case for display) ---

/** `KARNATAKA` → `Karnataka`; `NEW DELHI` → `New Delhi`; keeps tags like `(UT)` upper. */
export function titleCase(s?: string | null): string {
	if (!s) return '';
	return String(s)
		.toLowerCase()
		.replace(/\b[a-z]/g, (ch) => ch.toUpperCase())
		.replace(/\(([a-z]+)\)/gi, (_m, w) => `(${w.toUpperCase()})`);
}

/** A station's display name (already a real place name post-enrichment). */
export function stationLabel(s: { name: string }): string {
	return s.name;
}

/** `District, State` subtitle; drops the district when it equals the name, and
 *  shows just the state (or nothing) when district/state are missing. */
export function stationSubtitle(s: {
	name?: string;
	district?: string | null;
	state?: string | null;
}): string {
	const state = titleCase(s.state);
	const district = titleCase(s.district);
	if (district && district.toLowerCase() !== (s.name ?? '').toLowerCase()) {
		return state ? `${district}, ${state}` : district;
	}
	return state;
}
