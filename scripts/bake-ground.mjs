// Bake ground composites (day + night PNGs + mask) from topojson, hypsometric, and texture inputs.
// Rerun (pnpm bake:ground) when inputs or palette change.
// WORLD_W/CELL/DETAIL/projection must mirror PixelMap.svelte + theme.ts + geo.ts.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { geoConicConformal } from 'd3-geo';
import { feature } from 'topojson-client';

// ---- geometry ----
const WORLD_W = 1024;
const CELL = 8;
const DETAIL = 2; // ground sub-cells per cloud cell
const WORLD_H = WORLD_W * 1.06;
const GCELL = CELL / DETAIL;
const COLS = Math.floor(WORLD_W / GCELL);
const ROWS = Math.floor(WORLD_H / GCELL);

// ---- ground palette ----
const LAND = {
	day: { fill: '#63946F', dither: '#5E8F6A' },
	night: { fill: '#3E6B54', dither: '#3A664F' }
};
// built-up: subtle darkening, not a black hole. night = dark cool slate so
// unlit cells don't read as sand and lit ones pop as points of light.
const URBAN = {
	day: { fill: '#59685A', dither: '#525F53' },
	night: { fill: '#333D49', dither: '#2E3742' }
};
// shallow band: partial alpha blends with sky-sea background
const SEA = {
	day: { shallow: '#8FCBEF', dither: '#83C2E9' },
	night: { shallow: '#2E5A86', dither: '#29527C' }
};
const SEA_RING_WIDTH = 1; // ground cells of shallow band
const SEA_RING_ALPHA = 0.45;
// coast: gentle darkening toward an inked shoreline
const SHORE_DARKEN = 0.86;
// hypsometric: posterized into bands; blurred so Himalaya reads as broad zones
const TERRAIN_STRENGTH = 0.38;
const TERRAIN_STEP = 0.08;
const TERRAIN_BLUR_PASSES = 2;
const HYP_BBOX = { lon0: 66, lon1: 100, lat0: 4, lat1: 38 };
// night city lights: sparse warm-white pixels inside built-up cells. slightly
// sparser + gentler mix so they read as small muted points, not a wash; each lit
// cell also gets a per-cell brightness jitter so the field isn't uniformly bright
const CITY_LIGHT = '#FFE6B0';
const CITY_LIGHT_DENSITY = 0.11;
const CITY_LIGHT_MIX = 0.72;
const CITY_LIGHT_MIX_MIN = 0.45; // dimmest lights get this fraction of the mix
// grass tile width in px
const TILE_PX = 10;

const OUT_DIR = 'src/lib/assets/ground';

function hexRGB(hex) {
	const h = hex.replace('#', '');
	return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

async function loadPng(path) {
	return PNG.sync.read(await readFile(path));
}

async function loadTopo(path) {
	const topo = JSON.parse(await readFile(path, 'utf8'));
	const objName = Object.keys(topo.objects)[0];
	return feature(topo, topo.objects[objName]);
}

// even-odd scanline rasterizer; holes handled by even-odd rule
function rasterize(fc, project, W, H, scale) {
	const mask = new Uint8Array(W * H);
	for (const f of fc.features) {
		const g = f.geometry;
		if (!g) continue;
		const polys =
			g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
		for (const poly of polys) {
			const rings = poly.map((ring) =>
				ring.map(([lon, lat]) => {
					const p = project([lon, lat]);
					return [p[0] * scale, p[1] * scale];
				})
			);
			let y0 = Infinity;
			let y1 = -Infinity;
			for (const ring of rings)
				for (const [, y] of ring) {
					if (y < y0) y0 = y;
					if (y > y1) y1 = y;
				}
			const ya = Math.max(0, Math.floor(y0));
			const yb = Math.min(H - 1, Math.ceil(y1));
			for (let y = ya; y <= yb; y++) {
				const cy = y + 0.5;
				const xs = [];
				for (const ring of rings) {
					for (let i = 0; i < ring.length - 1; i++) {
						const [ax, ay] = ring[i];
						const [bx, by] = ring[i + 1];
						if (ay <= cy !== by <= cy) xs.push(ax + ((cy - ay) / (by - ay)) * (bx - ax));
					}
				}
				xs.sort((a, b) => a - b);
				for (let k = 0; k + 1 < xs.length; k += 2) {
					const xa = Math.max(0, Math.ceil(xs[k] - 0.5));
					const xb = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
					for (let x = xa; x <= xb; x++) mask[y * W + x] = 1;
				}
			}
		}
	}
	return mask;
}

// Deterministic per-cell hash for the night city-light scatter.
function cellHash(x, y) {
	let h = (x * 374761393 + y * 668265263) >>> 0;
	h = (h ^ (h >> 13)) >>> 0;
	h = (h * 1274126177) >>> 0;
	return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

const india = await loadTopo('src/lib/assets/geo/india.json');
const urbanFC = await loadTopo('src/lib/assets/geo/india-urban.json');
const hyp = await loadPng('src/lib/assets/images/hyp-india.png');
const tilePngs = await Promise.all([
	loadPng('src/lib/assets/images/medievalTile_57.png'),
	loadPng('src/lib/assets/images/medievalTile_58.png')
]);

const projection = geoConicConformal()
	.parallels([12, 36])
	.rotate([-82.5, 0])
	.fitExtent(
		[
			[CELL, CELL],
			[WORLD_W - CELL, WORLD_H - CELL]
		],
		india
	);

// urban supersampled 2x (many towns < 1 ground cell), masked to land only
const land = rasterize(india, projection, COLS, ROWS, 1 / GCELL);
const SS = 2;
const urbanSS = rasterize(urbanFC, projection, COLS * SS, ROWS * SS, SS / GCELL);
const urban = new Uint8Array(COLS * ROWS);
for (let y = 0; y < ROWS; y++) {
	for (let x = 0; x < COLS; x++) {
		const idx = y * COLS + x;
		if (!land[idx]) continue;
		outer: for (let sy = 0; sy < SS; sy++) {
			for (let sx = 0; sx < SS; sx++) {
				if (urbanSS[(y * SS + sy) * COLS * SS + (x * SS + sx)]) {
					urban[idx] = 1;
					break outer;
				}
			}
		}
	}
}

// Coast: land cells with a 4-neighbour sea side.
const coast = new Uint8Array(COLS * ROWS);
for (let y = 0; y < ROWS; y++) {
	for (let x = 0; x < COLS; x++) {
		const idx = y * COLS + x;
		if (!land[idx]) continue;
		const up = y > 0 ? land[idx - COLS] : 0;
		const dn = y < ROWS - 1 ? land[idx + COLS] : 0;
		const lf = x > 0 ? land[idx - 1] : 0;
		const rt = x < COLS - 1 ? land[idx + 1] : 0;
		if (!up || !dn || !lf || !rt) coast[idx] = 1;
	}
}

// Shallow water: sea cells within SEA_RING_WIDTH cells (8-neighbour) of land.
const shallow = new Uint8Array(COLS * ROWS);
let front = land;
for (let pass = 0; pass < SEA_RING_WIDTH; pass++) {
	const next = new Uint8Array(COLS * ROWS);
	for (let y = 0; y < ROWS; y++) {
		for (let x = 0; x < COLS; x++) {
			const idx = y * COLS + x;
			if (land[idx] || shallow[idx]) continue;
			outer: for (let dy = -1; dy <= 1; dy++) {
				for (let dx = -1; dx <= 1; dx++) {
					const nx = x + dx;
					const ny = y + dy;
					if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
					if (front[ny * COLS + nx]) {
						next[idx] = 1;
						break outer;
					}
				}
			}
		}
	}
	for (let i = 0; i < shallow.length; i++) if (next[i]) shallow[i] = 1;
	front = next;
}

// terrain: sample hyp raster, blur, normalize, posterize
function sampleHyp(lon, lat) {
	const { lon0, lon1, lat0, lat1 } = HYP_BBOX;
	if (lon < lon0 || lon >= lon1 || lat <= lat0 || lat > lat1) return null;
	const x = Math.min(hyp.width - 1, Math.floor(((lon - lon0) / (lon1 - lon0)) * hyp.width));
	const y = Math.min(hyp.height - 1, Math.floor(((lat1 - lat) / (lat1 - lat0)) * hyp.height));
	const i = (y * hyp.width + x) * 4;
	return [hyp.data[i], hyp.data[i + 1], hyp.data[i + 2]];
}

const samples = new Float32Array(COLS * ROWS * 3);
const mean = [0, 0, 0];
let n = 0;
for (let y = 0; y < ROWS; y++) {
	for (let x = 0; x < COLS; x++) {
		const idx = y * COLS + x;
		if (!land[idx]) continue;
		const ll = projection.invert([(x + 0.5) * GCELL, (y + 0.5) * GCELL]);
		const s = ll ? sampleHyp(ll[0], ll[1]) : null;
		if (!s) continue;
		samples[idx * 3] = s[0];
		samples[idx * 3 + 1] = s[1];
		samples[idx * 3 + 2] = s[2];
		mean[0] += s[0];
		mean[1] += s[1];
		mean[2] += s[2];
		n++;
	}
}
const relief = new Float32Array(COLS * ROWS * 3).fill(1);
if (n > 0) {
	mean[0] /= n;
	mean[1] /= n;
	mean[2] /= n;
	for (let pass = 0; pass < TERRAIN_BLUR_PASSES; pass++) {
		const src = samples.slice();
		for (let y = 0; y < ROWS; y++) {
			for (let x = 0; x < COLS; x++) {
				const idx = y * COLS + x;
				if (!land[idx] || src[idx * 3 + 1] === 0) continue;
				let sr = 0;
				let sg = 0;
				let sb = 0;
				let sn = 0;
				for (let dy = -1; dy <= 1; dy++) {
					for (let dx = -1; dx <= 1; dx++) {
						const nx = x + dx;
						const ny = y + dy;
						if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
						const ni = ny * COLS + nx;
						if (!land[ni] || src[ni * 3 + 1] === 0) continue;
						sr += src[ni * 3];
						sg += src[ni * 3 + 1];
						sb += src[ni * 3 + 2];
						sn++;
					}
				}
				if (sn) {
					samples[idx * 3] = sr / sn;
					samples[idx * 3 + 1] = sg / sn;
					samples[idx * 3 + 2] = sb / sn;
				}
			}
		}
	}
	for (let idx = 0; idx < COLS * ROWS; idx++) {
		if (!land[idx] || samples[idx * 3 + 1] === 0) continue;
		for (let ch = 0; ch < 3; ch++) {
			const f = 1 + TERRAIN_STRENGTH * (samples[idx * 3 + ch] / mean[ch] - 1);
			const q = Math.round(f / TERRAIN_STEP) * TERRAIN_STEP;
			relief[idx * 3 + ch] = Math.min(1.9, Math.max(0.5, q));
		}
	}
}

// Grass tiles: raw RGBA + mean of opaque pixels.
const tiles = tilePngs.map((p) => {
	let r = 0;
	let g = 0;
	let b = 0;
	let tn = 0;
	for (let i = 0; i < p.width * p.height; i++) {
		if (p.data[i * 4 + 3] > 127) {
			r += p.data[i * 4];
			g += p.data[i * 4 + 1];
			b += p.data[i * 4 + 2];
			tn++;
		}
	}
	tn = tn || 1;
	return { data: p.data, w: p.width, h: p.height, mean: [r / tn, g / tn, b / tn] };
});

function composeGround(mode) {
	const night = mode === 'night';
	const lRGB = hexRGB(LAND[mode].fill);
	const uRGB = hexRGB(URBAN[mode].fill);
	const sRGB = hexRGB(SEA[mode].shallow);
	const sdRGB = hexRGB(SEA[mode].dither);
	const lightRGB = hexRGB(CITY_LIGHT);
	const img = Buffer.alloc(COLS * ROWS * 4);
	for (let y = 0; y < ROWS; y++) {
		for (let x = 0; x < COLS; x++) {
			const idx = y * COLS + x;
			const o = idx * 4;
			if (!land[idx]) {
				if (shallow[idx]) {
					const base = (x + y) & 1 ? sdRGB : sRGB;
					img[o] = base[0];
					img[o + 1] = base[1];
					img[o + 2] = base[2];
					img[o + 3] = Math.round(SEA_RING_ALPHA * 255);
				}
				continue;
			}
			const built = urban[idx] === 1;
			const edge = coast[idx] ? SHORE_DARKEN : 1;
			const fr = (built ? 1 : relief[idx * 3]) * edge;
			const fg = (built ? 1 : relief[idx * 3 + 1]) * edge;
			const fb = (built ? 1 : relief[idx * 3 + 2]) * edge;
			const t = tiles[(Math.floor(x / TILE_PX) + Math.floor(y / TILE_PX)) % tiles.length];
			const sx = Math.floor(((x % TILE_PX) / TILE_PX) * t.w);
			const sy = Math.floor(((y % TILE_PX) / TILE_PX) * t.h);
			const si = (sy * t.w + sx) * 4;
			const tint = built ? uRGB : lRGB;
			let r = (t.data[si] * tint[0] * fr) / t.mean[0];
			let g = (t.data[si + 1] * tint[1] * fg) / t.mean[1];
			let b = (t.data[si + 2] * tint[2] * fb) / t.mean[2];
			if (night && built && cellHash(x, y) < CITY_LIGHT_DENSITY) {
				// decorrelated hash → per-cell brightness in [MIX_MIN, 1] of the base mix
					const bv = cellHash(x + 1013, y + 1619);
					const mix = CITY_LIGHT_MIX * (CITY_LIGHT_MIX_MIN + (1 - CITY_LIGHT_MIX_MIN) * bv);
					r = r + (lightRGB[0] - r) * mix;
					g = g + (lightRGB[1] - g) * mix;
					b = b + (lightRGB[2] - b) * mix;
			}
			img[o] = Math.min(255, r);
			img[o + 1] = Math.min(255, g);
			img[o + 2] = Math.min(255, b);
			img[o + 3] = 255;
		}
	}
	return img;
}

async function writePng(name, data) {
	const png = new PNG({ width: COLS, height: ROWS });
	data.copy(png.data);
	const buf = PNG.sync.write(png);
	await writeFile(`${OUT_DIR}/${name}`, buf);
	console.log(`  ${name} (${(buf.length / 1024).toFixed(0)} KB)`);
}

await mkdir(OUT_DIR, { recursive: true });
console.log(`bake-ground: ${COLS}x${ROWS} ground raster`);
await writePng('ground-day.png', composeGround('day'));
await writePng('ground-night.png', composeGround('night'));
const mask = Buffer.alloc(COLS * ROWS * 4);
for (let i = 0; i < COLS * ROWS; i++) {
	mask[i * 4] = land[i] ? 255 : 0;
	mask[i * 4 + 1] = shallow[i] ? 255 : 0;
	mask[i * 4 + 2] = urban[i] ? 255 : 0;
	mask[i * 4 + 3] = 255;
}
await writePng('ground-mask.png', mask);
console.log('bake-ground: done.');
