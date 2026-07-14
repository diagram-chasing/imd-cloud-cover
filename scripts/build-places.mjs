// Distil GeoNames IN.zip into a plain settlement gazetteer (streamed via unzip -p).
// Keeps places above POP_FLOOR + all capitals. Output feeds the scraper enrichment
// (seed_stations.py), which tags each settlement with an IMD district and folds a
// district-headline population onto each station. No station binding is done here —
// the old nearest-neighbour join was the source of the "spurious city" matching.
// Output: { name, lat, lon, pop, state, tier, aliases } per feature.
// Run from repo root: node scripts/build-places.mjs
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ZIP = resolve(ROOT, 'src/lib/assets/IN.zip');
const OUT = resolve(ROOT, 'scraper/data/geonames-places.json');

// capitals kept regardless of population
const POP_FLOOR = 15_000;
const KEEP_ALWAYS = new Set(['PPLC', 'PPLA', 'PPLA2']);

// GeoNames IN.txt column indices (tab-separated).
const COL = { name: 1, alt: 3, lat: 4, lon: 5, fclass: 6, fcode: 7, admin1: 10, pop: 14 };

// FIPS 10-4 admin1 codes (GeoNames' admin1 column for India) → state names.
const FIPS_STATE = {
	'01': 'Andaman and Nicobar Islands',
	'02': 'Andhra Pradesh',
	'03': 'Assam',
	'05': 'Chandigarh',
	'06': 'Dadra and Nagar Haveli',
	'07': 'Delhi',
	'09': 'Gujarat',
	10: 'Haryana',
	11: 'Himachal Pradesh',
	12: 'Jammu and Kashmir',
	13: 'Kerala',
	16: 'Maharashtra',
	17: 'Manipur',
	18: 'Meghalaya',
	19: 'Karnataka',
	20: 'Nagaland',
	21: 'Odisha',
	22: 'Puducherry',
	23: 'Punjab',
	24: 'Rajasthan',
	25: 'Tamil Nadu',
	26: 'Tripura',
	28: 'West Bengal',
	29: 'Sikkim',
	30: 'Arunachal Pradesh',
	31: 'Mizoram',
	32: 'Daman and Diu',
	33: 'Goa',
	34: 'Bihar',
	35: 'Madhya Pradesh',
	36: 'Uttar Pradesh',
	37: 'Chhattisgarh',
	38: 'Jharkhand',
	39: 'Uttarakhand',
	40: 'Telangana'
};

// curated exonyms: GeoNames alt-names miss these past the per-city cap
const ALIAS_EXTRA = {
	Mumbai: ['Bombay'],
	Chennai: ['Madras'],
	Kolkata: ['Calcutta'],
	Bengaluru: ['Bangalore'],
	Pune: ['Poona'],
	Kochi: ['Cochin'],
	Thiruvananthapuram: ['Trivandrum'],
	Mysuru: ['Mysore'],
	Vadodara: ['Baroda'],
	Prayagraj: ['Allahabad'],
	Varanasi: ['Benares', 'Banaras'],
	Kanpur: ['Cawnpore'],
	Gurugram: ['Gurgaon'],
	Puducherry: ['Pondicherry'],
	Kozhikode: ['Calicut'],
	Kannur: ['Cannanore'],
	Thoothukudi: ['Tuticorin'],
	Shivamogga: ['Shimoga'],
	Belagavi: ['Belgaum'],
	Hubballi: ['Hubli'],
	Vijayawada: ['Bezawada'],
	Panaji: ['Panjim']
};

function tierFor(pop) {
	if (pop >= 5_000_000) return 0; // megacity
	if (pop >= 1_000_000) return 1; // major city
	if (pop >= 200_000) return 2; // city
	return 3; // town
}

/** fold diacritics (ū/ā) to ASCII - Ships Whistle font lacks them */
function asciiName(name) {
	return name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

/** ASCII aliases from alt-names; curated ALIAS_EXTRA go first to survive the cap */
function aliasesFor(name, altField) {
	const nn = name.toLowerCase();
	const out = [];
	const seen = new Set([nn]);
	for (const a of ALIAS_EXTRA[name] ?? []) {
		const key = a.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(a);
	}
	for (const raw of (altField ?? '').split(',')) {
		const a = raw.trim();
		if (a.length < 3) continue;
		if (!/^[\x20-\x7E]+$/.test(a)) continue; // ASCII printable only
		const key = a.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(a);
		if (out.length >= 5) break;
	}
	return out;
}

const kept = [];
const unzip = spawn('unzip', ['-p', ZIP, 'IN.txt']);
unzip.on('error', (e) => {
	console.error('failed to spawn unzip:', e.message);
	process.exit(1);
});
const rl = createInterface({ input: unzip.stdout, crlfDelay: Infinity });

let scanned = 0;
rl.on('line', (line) => {
	scanned++;
	const c = line.split('\t');
	if (c[COL.fclass] !== 'P') return;
	const fcode = c[COL.fcode];
	const pop = parseInt(c[COL.pop], 10) || 0;
	if (pop < POP_FLOOR && !KEEP_ALWAYS.has(fcode)) return;

	const name = asciiName(c[COL.name]);
	const lat = parseFloat(c[COL.lat]);
	const lon = parseFloat(c[COL.lon]);
	if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) return;

	kept.push({
		name,
		lat: Math.round(lat * 1e4) / 1e4,
		lon: Math.round(lon * 1e4) / 1e4,
		pop,
		state: FIPS_STATE[c[COL.admin1]] ?? null,
		tier: tierFor(pop),
		aliases: aliasesFor(name, c[COL.alt])
	});
});

rl.on('close', () => {
	// Biggest first: label decluttering walks in priority order, and this keeps
	// the more prominent duplicate when two rows share a name.
	kept.sort((a, b) => b.pop - a.pop);
	const seen = new Set();
	const features = [];
	for (const p of kept) {
		const key = `${p.name.toLowerCase()}|${p.state ?? ''}`;
		if (seen.has(key)) continue;
		seen.add(key);
		features.push({
			type: 'Feature',
			properties: {
				name: p.name,
				pop: p.pop,
				state: p.state,
				tier: p.tier,
				aliases: p.aliases
			},
			geometry: { type: 'Point', coordinates: [p.lon, p.lat] }
		});
	}
	const fc = { type: 'FeatureCollection', name: 'india_places', features };
	writeFileSync(OUT, JSON.stringify(fc));
	console.error(
		`scanned ${scanned} rows → kept ${features.length} places → ${OUT} ` +
			`(${(JSON.stringify(fc).length / 1024).toFixed(0)} KB raw)`
	);
});
