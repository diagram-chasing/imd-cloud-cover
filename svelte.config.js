import { mdsvex } from 'mdsvex';
import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter({ fallback: '404.html' }),
		// The site is served under a path prefix on the studio domain
		// (diagramchasing.fun/2026/mapping-clouds) via a Netlify 200-rewrite proxy.
		// paths.base makes the client router, prerendered links, and the SPA
		// fallback all carry that prefix. Keep in sync with SITE_BASE in src/lib/site.ts.
		//
		// relative:false -> ABSOLUTE asset URLs (/2026/mapping-clouds/_app/...). Required
		// because the entry URL is visited without a trailing slash (/2026/mapping-clouds),
		// and relative "./_app/..." would resolve against the parent (/2026/), dropping the
		// prefix. Absolute paths are trailing-slash-independent.
		paths: { base: '/2026/mapping-clouds', relative: false }
	},
	preprocess: [mdsvex({ extensions: ['.svx', '.md'] })],
	extensions: ['.svelte', '.svx', '.md']
};

export default config;
