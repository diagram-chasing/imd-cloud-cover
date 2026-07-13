// prerendered sitemap; URLs against SITE_BASE (site lives at a subpath)
import type { RequestHandler } from './$types';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CitiesRollup, StationsManifest } from '$lib/types';
import { citySlugs } from '$lib/city/slug.js';
import { SITE_BASE } from '$lib/site';

export const prerender = true;

function readView<T>(rel: string): T {
	for (const dir of ['static/baked', 'static/sample']) {
		const p = resolve(dir, rel);
		if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8')) as T;
	}
	throw new Error(`sitemap: missing data view ${rel} (baked & sample)`);
}

export const GET: RequestHandler = () => {
	const cities = readView<CitiesRollup>('rollups/cities.json');
	const manifest = readView<StationsManifest>('meta/stations.json');
	const { codeBySlug, slugByCode } = citySlugs(cities.cities);

	const paths = [
		'',
		...Object.keys(codeBySlug).map((slug) => `/city/${slug}`),
		// City-backed stations redirect to /city/[slug]; list only the standalone ones.
		...Object.keys(manifest.stations)
			.filter((code) => !slugByCode[code])
			.map((code) => `/station/${code}`)
	];

	const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((p) => `\t<url><loc>${SITE_BASE}${p}</loc></url>`).join('\n')}
</urlset>`;

	return new Response(body, {
		headers: { 'content-type': 'application/xml' }
	});
};
