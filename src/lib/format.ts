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
import coverModel from '$lib/data/cover-model.json';

// scraper/tools/validate_sources.py reads the same file — one source of truth.
const { l: A_L, m: A_M, h: A_H } = coverModel.opacity;
const EDGES = coverModel.edges;

/** Effective total cover 0..100: random-overlap of the three layers,
 *  cover = 1 − Π(1 − aᵢ·cᵢ), with opacity aᵢ discounting translucent decks
 *  (see cover-model.json). The map's cloud shadows use it too. */
export function effectiveCover(v: { h: number; m: number; l: number }): number {
	return (
		100 * (1 - (1 - (A_L * v.l) / 100) * (1 - (A_M * v.m) / 100) * (1 - (A_H * v.h) / 100))
	);
}

const RAIN_LABEL = ['', 'LIGHT RAIN', 'RAIN', 'HEAVY RAIN'];
const COVER_LABEL = ['CLEAR', 'MOSTLY CLEAR', 'PARTLY CLOUDY', 'MOSTLY CLOUDY', 'OVERCAST'];

/** Band values → sky-condition label. Edges are the NWS okta bins; rain,
 *  when the view carries it, overrides — a raining "CLEAR" must never show. */
export function skyCondition(v: { h: number; m: number; l: number; r?: number } | null): string {
	if (!v) return '';
	const rt = rainTier(v.r);
	if (rt > 0) return RAIN_LABEL[rt];
	const c = effectiveCover(v);
	let i = 0;
	while (i < EDGES.length && c >= EDGES[i]) i++;
	return COVER_LABEL[i];
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
