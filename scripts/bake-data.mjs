// Bake the data views into the build.
//
// Downloads the homepage/station-shared JSON views from the data endpoint
// (VITE_R2_PUBLIC_URL) into static/baked/ so production serves them same-origin
// and the prerendered homepage can <link rel="preload"> them. It also bakes the
// per-station tail JSON — history/{code}.json and the latest date's
// {date}/{code}-meteogram.json — so a station page renders fully self-contained
// from /baked and never needs the Worker to draw. Only the raw meteogram .webp
// images (external click-through links, never rendered) stay on the remote endpoint.
//
// Usage: node scripts/bake-data.mjs [--if-stale] [--core-only]
//   --if-stale   skip if the newest baked core file is under an hour old (dev)
//   --core-only  bake only the core views, skip the ~2,500-file tail (dev)

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
	'rollups/30d.json'
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

// Bake the per-station tail: history/{code}.json for every station plus the
// latest date's {date}/{code}-meteogram.json. Best-effort — a station missing a
// history or forecast file is warned and skipped, not fatal (the app falls back
// to the remote endpoint for anything unbaked).
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

	console.log(`bake-data: fetching tail (${views.length} files, ${codes.length} stations @ ${date})`);
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
