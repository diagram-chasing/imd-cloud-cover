

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** ISO `YYYY-MM-DD` → `07 JUL 2026`; passes through anything unparseable. */
export function prettyDate(iso?: string): string {
	if (!iso) return '';
	const [y, m, d] = iso.split('-').map(Number);
	if (!y || !m || !d) return iso;
	return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
}
