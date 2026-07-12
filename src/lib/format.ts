// Display-derivation helpers: turn raw data/band values into UI strings.

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** ISO `YYYY-MM-DD` → `07 JUL 2026`; passes through anything unparseable. */
export function prettyDate(iso?: string): string {
	if (!iso) return '';
	const [y, m, d] = iso.split('-').map(Number);
	if (!y || !m || !d) return iso;
	return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
}

function effectiveCover(v: { h: number; m: number; l: number }): number {
	return Math.max(v.l, v.m * 0.8, v.h * 0.45);
}

/** Band values → sky-condition label (CLEAR … OVERCAST). */
export function skyCondition(v: { h: number; m: number; l: number } | null): string {
	if (!v) return '';
	const c = effectiveCover(v);
	if (c < 13) return 'CLEAR';
	if (c < 38) return 'MOSTLY CLEAR';
	if (c < 63) return 'PARTLY CLOUDY';
	if (c < 88) return 'MOSTLY CLOUDY';
	return 'OVERCAST';
}
