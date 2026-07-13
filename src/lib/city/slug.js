// plain JS so build-og.mjs can import without a TS loader; slug.d.ts carries types

/**
 * Fold diacritics to ASCII, lowercase, collapse non-alphanumeric runs to hyphens.
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
 * Build station-code <-> slug maps. Collisions (e.g. two Gorakhpurs) get state
 * appended, then station code as last resort.
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
