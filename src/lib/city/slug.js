// City slug helpers, shared by the app ($lib/city/slug.js) and the build-time OG
// script (scripts/build-og.mjs imports this file by relative path). Kept plain JS
// so Node runs it without a TypeScript loader; slug.d.ts carries the app types.

/**
 * Kebab-case a city name: fold diacritics to ASCII, lowercase, collapse any run
 * of non-alphanumerics to a single hyphen, and trim leading/trailing hyphens.
 * @param {string} name
 * @returns {string}
 */
export function slugify(name) {
	return String(name)
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

/**
 * Build the two-way station-code ↔ slug maps for a cities rollup. Names that
 * collide (e.g. the two Gorakhpurs) get their state appended so every slug is
 * unique; if that still collides, the station code is appended as a last resort.
 * Deterministic for a given key order.
 * @param {Record<string, { name: string, state: (string|null) }>} cities
 * @returns {{ slugByCode: Record<string,string>, codeBySlug: Record<string,string> }}
 */
export function citySlugs(cities) {
	const codes = Object.keys(cities);
	const bare = {};
	const claims = {};
	for (const code of codes) {
		const s = slugify(cities[code].name);
		bare[code] = s;
		claims[s] = (claims[s] ?? 0) + 1;
	}
	/** @type {Record<string,string>} */
	const slugByCode = {};
	/** @type {Record<string,string>} */
	const codeBySlug = {};
	for (const code of codes) {
		let s = bare[code];
		if (claims[s] > 1) s = slugify(`${cities[code].name} ${cities[code].state ?? ''}`);
		while (codeBySlug[s]) s = slugify(`${s} ${code}`);
		slugByCode[code] = s;
		codeBySlug[s] = code;
	}
	return { slugByCode, codeBySlug };
}
