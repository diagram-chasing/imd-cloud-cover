// Display-name fixups applied at every data-read boundary (server `readView` and
// client `fetch*`), so the corrections survive a re-bake instead of living in the
// upstream scrape. Two jobs: rename a handful of ambiguously-enriched stations,
// and normalise state strings (IMD stores "TAMILNADU" with no space).

/** 2-letter code per state/UT, keyed by the normalised name minus any "(UT)" tag. */
export const STATE_SHORT: Record<string, string> = {
	'ANDAMAN & NICOBAR ISLANDS': 'AN',
	'ANDHRA PRADESH': 'AP',
	'ARUNACHAL PRADESH': 'AR',
	ASSAM: 'AS',
	BIHAR: 'BR',
	CHANDIGARH: 'CH',
	CHHATTISGARH: 'CG',
	'DADRA & NAGAR HAVELI AND DAMAN & DIU': 'DN',
	DELHI: 'DL',
	GOA: 'GA',
	GUJARAT: 'GJ',
	HARYANA: 'HR',
	'HIMACHAL PRADESH': 'HP',
	'JAMMU & KASHMIR': 'JK',
	JHARKHAND: 'JH',
	KARNATAKA: 'KA',
	KERALA: 'KL',
	LADAKH: 'LA',
	LAKSHADWEEP: 'LD',
	'MADHYA PRADESH': 'MP',
	MAHARASHTRA: 'MH',
	MANIPUR: 'MN',
	MEGHALAYA: 'ML',
	MIZORAM: 'MZ',
	NAGALAND: 'NL',
	ODISHA: 'OD',
	PUDUCHERRY: 'PY',
	PUNJAB: 'PB',
	RAJASTHAN: 'RJ',
	SIKKIM: 'SK',
	'TAMIL NADU': 'TN',
	TELANGANA: 'TS',
	TRIPURA: 'TR',
	'UTTAR PRADESH': 'UP',
	UTTARAKHAND: 'UK',
	'WEST BENGAL': 'WB'
};

// Malformed state names IMD ships → the spaced form. Add rows here as they surface.
const STATE_NAME_FIX: Record<string, string> = {
	TAMILNADU: 'TAMIL NADU'
};

/** Two distinct IMD stations enrich to the same name; give the odd one out a
 *  distinct label so map/list rows never collide. Keyed by station code. */
export const NAME_OVERRIDES: Record<string, string> = {
	// A second "Bengaluru Rural" sat on top of the real one; its code already
	// reads URBAN and it lies at the urban latitude.
	'BNG-URBAN': 'Bengaluru Urban'
};

/** Uppercase state string, spacing repaired ("TAMILNADU" → "TAMIL NADU"). */
export function fmtStateName(raw?: string | null): string {
	if (!raw) return '';
	const up = raw.trim().toUpperCase();
	return STATE_NAME_FIX[up] ?? up;
}

/** 2-letter state code, or '' when unknown. */
export function stateShort(raw?: string | null): string {
	if (!raw) return '';
	const key = fmtStateName(raw)
		.replace(/\s*\(UT\)\s*$/, '')
		.trim();
	return STATE_SHORT[key] ?? '';
}

/** `"Krishnagiri"` + `"TAMILNADU"` → `"Krishnagiri (TN)"`; no tag when unknown. */
export function withStateTag(name: string, state?: string | null): string {
	const s = stateShort(state);
	return s ? `${name} (${s})` : name;
}

type WithNameState = { name?: string; state?: string | null };

function fixEntry(code: string, e: WithNameState) {
	if (NAME_OVERRIDES[code]) e.name = NAME_OVERRIDES[code];
	if (e.state) e.state = fmtStateName(e.state);
}

/** Apply name overrides + state normalisation to a stations manifest, in place. */
export function normalizeStationsManifest<T extends { stations?: Record<string, WithNameState> }>(
	m: T
): T {
	if (m?.stations) for (const [code, s] of Object.entries(m.stations)) fixEntry(code, s);
	return m;
}

/** Apply name overrides + state normalisation to a cities rollup, in place. */
export function normalizeCities<T extends { cities?: Record<string, WithNameState> }>(c: T): T {
	if (c?.cities) for (const [code, city] of Object.entries(c.cities)) fixEntry(code, city);
	return c;
}
