// Download JSON views from VITE_R2_PUBLIC_URL into static/baked/ (same-origin, preloadable).
// Also bakes per-station tail so station pages render without a Worker call.
// Usage: node scripts/bake-data.mjs [--if-stale] [--core-only]

import { mkdir, writeFile, stat, readFile } from 'node:fs/promises';
import path from 'node:path';

try {
	process.loadEnvFile('.env');
} catch {
	// no .env (CI passes the variable directly)
}

const VIEWS = [
	'meta/stations.json',
	'latest/all-stations.json',
	'latest/summary.json',
	'rollups/7d.json',
	'rollups/30d.json',
	'rollups/cities.json'
];
const OUT = 'static/baked';
const STALE_MS = 60 * 60 * 1000;

const base = (process.env.VITE_R2_PUBLIC_URL || '').replace(/\/$/, '');
if (!base) {
	console.log('bake-data: VITE_R2_PUBLIC_URL unset — skipping (app falls back to /sample).');
	process.exit(0);
}

if (process.argv.includes('--if-stale')) {
	const ages = await Promise.all(
		VIEWS.map((v) =>
			stat(path.join(OUT, v))
				.then((s) => Date.now() - s.mtimeMs)
				.catch(() => Infinity)
		)
	);
	if (Math.max(...ages) < STALE_MS) {
		console.log('bake-data: baked views are fresh, skipping.');
		process.exit(0);
	}
}

console.log(`bake-data: fetching ${VIEWS.length} views from ${base}`);
await Promise.all(
	VIEWS.map(async (view) => {
		const res = await fetch(`${base}/${view}`);
		if (!res.ok) throw new Error(`bake-data: ${view} failed (${res.status})`);
		const body = await res.text();
		JSON.parse(body); // refuse to bake a truncated/HTML response
		const file = path.join(OUT, view);
		await mkdir(path.dirname(file), { recursive: true });
		await writeFile(file, body);
		console.log(`  ${view} (${(body.length / 1024).toFixed(0)} KB)`);
	})
);

if (!process.argv.includes('--core-only')) {
	await bakeTail();
}
console.log('bake-data: done.');

// per-station tail: history + latest forecast. best-effort; missing files are skipped
async function bakeTail() {
	const stations = JSON.parse(await readFile(path.join(OUT, 'meta/stations.json'), 'utf8'));
	const summary = JSON.parse(await readFile(path.join(OUT, 'latest/summary.json'), 'utf8'));
	const codes = Object.keys(stations.stations ?? {});
	const date = summary.date;
	if (!date) throw new Error('bake-data: summary.json has no date — cannot bake forecasts');

	const views = [];
	for (const code of codes) {
		views.push(`history/${code}.json`);
		views.push(`${date}/${code}-meteogram.json`);
	}

	console.log(
		`bake-data: fetching tail (${views.length} files, ${codes.length} stations @ ${date})`
	);
	let ok = 0;
	let skipped = 0;
	let bytes = 0;
	await pool(views, 24, async (view) => {
		try {
			const res = await fetch(`${base}/${view}`);
			if (!res.ok) throw new Error(`${res.status}`);
			const body = await res.text();
			JSON.parse(body); // refuse to bake a truncated/HTML response
			const file = path.join(OUT, view);
			await mkdir(path.dirname(file), { recursive: true });
			await writeFile(file, body);
			ok++;
			bytes += body.length;
		} catch (err) {
			skipped++;
			if (skipped <= 10) console.warn(`  skip ${view} (${err.message})`);
		}
	});
	console.log(
		`bake-data: tail baked ${ok} files (${skipped} skipped, ${(bytes / 1024 / 1024).toFixed(1)} MB)`
	);
}

// Run `worker` over `items` with at most `limit` in flight at once.
async function pool(items, limit, worker) {
	let i = 0;
	const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (i < items.length) {
			const item = items[i++];
			await worker(item);
		}
	});
	await Promise.all(runners);
}
