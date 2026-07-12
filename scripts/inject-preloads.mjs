import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifestPath = resolve(root, '.svelte-kit/output/client/.vite/manifest.json');
const htmlPath = resolve(root, 'build/index.html');

const EXCLUDE = /WebGPURenderer\.mjs$|CanvasRenderer\.mjs$/;

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
let html = readFileSync(htmlPath, 'utf8');

// Idempotent: strip any previously injected block before re-injecting.
const MARK_OPEN = '<!-- inject-preloads -->';
const MARK_CLOSE = '<!-- /inject-preloads -->';
html = html.replace(new RegExp(`\\s*${MARK_OPEN}[\\s\\S]*?${MARK_CLOSE}`), '');

// Chunk files the page already loads (SvelteKit's own preload tags).
const preloaded = new Set(
	[...html.matchAll(/href="\.\/(_app\/immutable\/[^"]+\.js)"/g)].map((m) => m[1])
);

const seed = Object.keys(manifest).find(
	(k) => manifest[k].name === 'PixelMap' && k.endsWith('.js')
);
if (!seed) {
	console.error('inject-preloads: no "PixelMap" chunk in the Vite manifest — walk is broken.');
	process.exit(1);
}

const wanted = new Map(); // file -> manifest entry, in discovery order
const visited = new Set();
function visit(key) {
	if (visited.has(key) || EXCLUDE.test(key)) return;
	visited.add(key);
	const e = manifest[key];
	if (!e) return;
	if (!preloaded.has(e.file)) wanted.set(e.file, e);
	for (const imp of e.imports ?? []) visit(imp);
	for (const dyn of e.dynamicImports ?? []) visit(dyn);
}
visit(seed);

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
			// crossorigin matches Vite's dynamic-import CSS <link> credentials mode;
			// without it the preload is discarded and the file fetched twice.
			links.push(`<link href="./${css}" rel="preload" as="style" crossorigin>`);
		}
	}
	for (const asset of e.assets ?? []) {
		if (/\.png$/.test(asset) && !seenExtra.has(asset) && !html.includes(asset)) {
			seenExtra.add(asset);
			links.push(`<link href="./${asset}" rel="preload" as="image">`);
		}
	}
}
// The day/night ground PNGs sit in shared chunks of the static route graph, so
// the walk above misses them — but MapShell only sets its <img> src at runtime
// and PixelMap's ground texture gates first paint, so hint them explicitly.
// (Which one is critical depends on the visitor's local time; both total ~58 KB.)
for (const f of readdirSync(resolve(root, 'build/_app/immutable/assets'))) {
	const asset = `_app/immutable/assets/${f}`;
	if (/^ground-(day|night)\./.test(f) && !seenExtra.has(asset) && !html.includes(asset)) {
		seenExtra.add(asset);
		links.push(`<link href="./${asset}" rel="preload" as="image">`);
	}
}

html = html.replace(
	'</head>',
	`\t\t${MARK_OPEN}\n\t\t${links.join('\n\t\t')}\n\t\t${MARK_CLOSE}\n\t</head>`
);
writeFileSync(htmlPath, html);
console.log(`inject-preloads: added ${links.length} preload hints to build/index.html`);
for (const l of links) console.log('  ' + l.match(/href="([^"]+)"/)[1]);
