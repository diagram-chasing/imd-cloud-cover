

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** ISO `YYYY-MM-DD` → `07 JUL 2026`; passes through anything unparseable. */
export function prettyDate(iso?: string): string {
	if (!iso) return '';
	const [y, m, d] = iso.split('-').map(Number);
	if (!y || !m || !d) return iso;
	return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
}

/** ISO date → `08 JUN` (no year — for in-year ranges like streak spans). */
export function prettyDay(iso?: string): string {
	if (!iso) return '';
	const [y, m, d] = iso.split('-').map(Number);
	if (!y || !m || !d) return iso ?? '';
	return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]}`;
}

/** 1 → `1ST`, 2 → `2ND`, 23 → `23RD` — uppercase to match the site's small caps. */
export function ordinal(n: number): string {
	const suffix = ['TH', 'ST', 'ND', 'RD'];
	const v = n % 100;
	return `${n}${suffix[(v - 20) % 10] ?? suffix[v] ?? suffix[0]}`;
}
