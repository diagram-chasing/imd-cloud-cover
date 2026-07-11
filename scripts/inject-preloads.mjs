// Postbuild: inject <link rel="modulepreload"> hints for the PixelMap/pixi
// dynamic-import closure into the prerendered homepage.
//
// Why: the homepage lazy-imports PixelMap.svelte (which bundles pixi.js), and
// pixi's Application.init() lazy-imports two more levels (environment chunk →
// WebGLRenderer chunk). SvelteKit only preloads the static route graph, so on
// first visit those ~150 KB gz download as 3+ serialized round trips *after*
// hydration — the 1–2 s "shape first, clouds later" gap on 4G. Preloading the
// whole closure from the HTML head turns the waterfall into one parallel fetch.
//
// The chunk set is derived from the Vite manifest each build (hashes change
// every build; nothing is hardcoded): start from the chunks the prerendered
// HTML already preloads, walk their dynamicImports, and pull in each dynamic
// entry's static-import closure, recursing into nested dynamicImports. The
// WebGPU and Canvas renderer chunks are excluded — with `preference: 'webgl'`
// pixi never requests them.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifestPath = resolve(root, '.svelte-kit/output/client/.vite/manifest.json');
const htmlPath = resolve(root, 'build/index.html');

const EXCLUDE = /WebGPURenderer\.mjs$|CanvasRenderer\.mjs$/;

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
let html = readFileSync(htmlPath, 'utf8');

// Chunk files the page already loads (SvelteKit's own preload tags).
const preloaded = new Set(
	[...html.matchAll(/href="\.\/(_app\/immutable\/[^"]+\.js)"/g)].map((m) => m[1])
);

const byFile = new Map(Object.values(manifest).map((e) => [e.file, e]));

// Walk: seed with the already-preloaded entries, follow static imports of any
// chunk we decide to preload, and branch into dynamicImports (minus exclusions).
const wanted = new Map(); // file -> manifest entry, in discovery order
const visited = new Set();
function visit(key, viaDynamic) {
	if (visited.has(key) || EXCLUDE.test(key)) return;
	visited.add(key);
	const e = manifest[key];
	if (!e) return;
	if (viaDynamic && !preloaded.has(e.file)) wanted.set(e.file, e);
	for (const imp of e.imports ?? []) visit(imp, viaDynamic || !preloaded.has(manifest[imp]?.file));
	for (const dyn of e.dynamicImports ?? []) visit(dyn, true);
}
for (const [key, e] of Object.entries(manifest)) if (preloaded.has(e.file)) visit(key, false);

if (wanted.size === 0) {
	console.error('inject-preloads: resolved zero chunks to preload — manifest walk is broken.');
	process.exit(1);
}

const links = [];
for (const file of wanted.keys()) links.push(`<link href="./${file}" rel="modulepreload">`);
// Stylesheets and assets (ground PNGs) referenced by the preloaded chunks:
// fetched with the chunks instead of at first render inside the map.
const seenExtra = new Set();
for (const e of wanted.values()) {
	for (const css of e.css ?? []) {
		if (!seenExtra.has(css) && !html.includes(css)) {
			seenExtra.add(css);
			links.push(`<link href="./${css}" rel="preload" as="style">`);
		}
	}
	for (const asset of e.assets ?? []) {
		if (/\.png$/.test(asset) && !seenExtra.has(asset) && !html.includes(asset)) {
			seenExtra.add(asset);
			links.push(`<link href="./${asset}" rel="preload" as="image">`);
		}
	}
}

html = html.replace('</head>', `\t\t${links.join('\n\t\t')}\n\t</head>`);
writeFileSync(htmlPath, html);
console.log(`inject-preloads: added ${links.length} preload hints to build/index.html`);
for (const l of links) console.log('  ' + l.match(/href="([^"]+)"/)[1]);
