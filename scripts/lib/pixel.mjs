// Shared pixel-art helpers for the share-image bakers (build-og, build-sharecard).
// Ports of src/lib/map/hash.ts, map/sprites.ts, stations/clouds.ts, theme.ts and
// format.ts — one copy so the baked cards can't drift from the app or each other.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';

// --- palette (theme.ts / layout.css tokens) -----------------------------------
export const UI = {
	ink: '#0B1D3A',
	paper: '#FDFBF4',
	accent: '#399DE1',
	sunGold: '#F2C14E',
	daySea: '#2E7CC4',
	cloudBlock: '#D8E8F4'
};
export const CLOUD = {
	low: { fill: '#FFFFFF', shadow: '#C4D8EC', alpha: 1 },
	middle: { fill: '#B7CFEA', alpha: 0.95 },
	high: { fill: '#E6F2FB', alpha: 0.55 }
};
export const SHADOW_FILL = '#0a1a28';

// --- format.ts ------------------------------------------------------------------
export const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function prettyDate(iso) {
	if (!iso) return '';
	const [y, m, d] = iso.split('-').map(Number);
	if (!y || !m || !d) return iso;
	return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
}

export function effectiveCover(v) {
	return Math.max(v.l, v.m * 0.8, v.h * 0.45);
}

export function skyCondition(v) {
	if (!v) return '';
	const c = effectiveCover(v);
	if (c < 13) return 'CLEAR';
	if (c < 38) return 'MOSTLY CLEAR';
	if (c < 63) return 'PARTLY CLOUDY';
	if (c < 88) return 'MOSTLY CLOUDY';
	return 'OVERCAST';
}

// --- stations/distance.ts ---------------------------------------------------------
export function haversineKm(aLat, aLon, bLat, bLon) {
	const R = 6371;
	const dLat = ((bLat - aLat) * Math.PI) / 180;
	const dLon = ((bLon - aLon) * Math.PI) / 180;
	const la1 = (aLat * Math.PI) / 180;
	const la2 = (bLat * Math.PI) / 180;
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
	return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// --- hash/PRNG (map/hash.ts) --------------------------------------------------------
export function fnv1a(str) {
	let h = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}
export function jitter(code, salt, range = 1) {
	return (fnv1a(code + salt) % (2 * range + 1)) - range;
}
export function mulberry32(seed) {
	let a = seed >>> 0;
	return function () {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// --- theme.ts coverTier ---------------------------------------------------------------
const COVER_FLOOR = 20;
const COVER_GAMMA = 1.3;
export function coverTier(cover) {
	if (cover < COVER_FLOOR) return 0;
	const t = (cover - COVER_FLOOR) / (100 - COVER_FLOOR);
	return Math.min(4, Math.max(1, Math.ceil(Math.pow(t, COVER_GAMMA) * 4)));
}

// --- sprite patterns (map/sprites.ts) ----------------------------------------------------
export const MARK_VARIANTS = 3;
export const MARK_ALPHA = { high: 0.55, middle: 0.95, low: 1 };
export const TIER_ALPHA = [0.42, 0.6, 0.82, 1];

const SIZES = {
	low: [
		[4, 2],
		[5, 3],
		[7, 3],
		[8, 3]
	],
	middle: [
		[5, 2],
		[6, 2],
		[8, 2],
		[9, 2]
	]
};
const HIGH_W = [3, 5, 7, 9];

function puffProfile(rand, w, maxH, rough) {
	const peak = 0.5 + (rand() - 0.5) * 0.7;
	const h = [];
	for (let x = 0; x < w; x++) {
		const t = w > 1 ? x / (w - 1) : 0.5;
		const d = Math.abs(t - peak) / Math.max(peak, 1 - peak);
		const arch = Math.cos((d * Math.PI) / 2);
		h.push(Math.round(arch * maxH + (rand() - 0.5) * rough));
	}
	for (let x = 1; x < w - 1; x++) h[x] = Math.max(1, Math.min(maxH, h[x]));
	h[0] = Math.max(0, Math.min(1, h[0]));
	h[w - 1] = Math.max(0, Math.min(1, h[w - 1]));
	return h;
}
function profileToPattern(heights, rows) {
	const w = heights.length;
	const grid = Array.from({ length: rows }, () => new Array(w).fill(0));
	for (let x = 0; x < w; x++) {
		for (let y = rows - heights[x]; y < rows; y++) if (y >= 0) grid[y][x] = 1;
	}
	return grid;
}
function cirrusPattern(rand, w) {
	const grid = [new Array(w).fill(0), new Array(w).fill(0)];
	let x = 0;
	let drew = false;
	while (x < w) {
		if (rand() < 0.62) {
			const len = 1 + Math.floor(rand() * 2);
			const y = rand() < 0.5 ? 0 : 1;
			for (let i = 0; i < len && x + i < w; i++) grid[y][x + i] = 1;
			drew = true;
			x += len + 2 + Math.floor(rand() * 2);
		} else {
			x += 1 + Math.floor(rand() * 2);
		}
	}
	if (!drew) grid[0][0] = grid[0][Math.min(1, w - 1)] = 1;
	return grid;
}
export function makePattern(band, tier, variant) {
	const rand = mulberry32(fnv1a(`${band}:${tier}:${variant}`));
	if (band === 'high') return cirrusPattern(rand, HIGH_W[tier - 1]);
	const [w, maxH] = SIZES[band][tier - 1];
	return profileToPattern(puffProfile(rand, w, maxH, band === 'low' ? 1.5 : 0.9), maxH);
}

// fill/alphaScale overrides let the same pattern double as the ground shadow
export function drawMark(pattern, band, tier, cell, fill = null, alphaScale = 1) {
	const rows = pattern.length;
	const cols = Math.max(...pattern.map((r) => r.length));
	const canvas = createCanvas(cols * cell, rows * cell);
	const ctx = canvas.getContext('2d');
	ctx.imageSmoothingEnabled = false;
	ctx.globalAlpha = MARK_ALPHA[band] * TIER_ALPHA[tier - 1] * alphaScale;
	ctx.fillStyle = fill ?? CLOUD[band].fill;
	for (let y = 0; y < rows; y++) {
		for (let x = 0; x < cols; x++) {
			if (pattern[y][x]) ctx.fillRect(x * cell, y * cell, cell, cell);
		}
	}
	if (!fill && band === 'low' && rows >= 3) {
		ctx.fillStyle = CLOUD.low.shadow;
		for (let x = 0; x < cols; x++) {
			let by = -1;
			for (let y = 0; y < rows; y++) if (pattern[y][x]) by = y;
			if (by >= 0) ctx.fillRect(x * cell, by * cell, cell, cell);
		}
	}
	return canvas;
}

// --- station cloud tower (stations/clouds.ts) -----------------------------------------------
const TOWER_BANDS = [
	{ band: 'high', key: 'h' },
	{ band: 'middle', key: 'm' },
	{ band: 'low', key: 'l' }
];

/** Build a station's cloud tower from its {h,m,l} cover. Empty tower = clear sky. */
export function buildTower(code, v) {
	const variant = fnv1a(code) % MARK_VARIANTS;
	const layers = [];
	if (v) {
		for (const { band, key } of TOWER_BANDS) {
			const tier = coverTier(v[key]);
			if (tier === 0) continue;
			const rows = makePattern(band, tier, variant);
			layers.push({
				rows,
				cols: Math.max(...rows.map((r) => r.length)),
				fill: CLOUD[band].fill,
				opacity: MARK_ALPHA[band] * TIER_ALPHA[tier - 1]
			});
		}
	}
	const w = layers.length ? Math.max(...layers.map((l) => l.cols)) : 0;
	const cells = [];
	let y0 = 0;
	for (const layer of layers) {
		const xoff = Math.floor((w - layer.cols) / 2);
		for (let ry = 0; ry < layer.rows.length; ry++) {
			for (let cx = 0; cx < layer.rows[ry].length; cx++) {
				if (layer.rows[ry][cx]) {
					cells.push({ x: xoff + cx, y: y0 + ry, fill: layer.fill, opacity: layer.opacity });
				}
			}
		}
		y0 += layer.rows.length;
	}
	return { cells, w, h: y0 };
}

// --- pixel sun for clear skies (CloudGlyph.svelte) ------------------------------------------
// prettier-ignore
export const SUN = [
	[4, 0],
	[1, 1], [7, 1],
	[3, 2], [4, 2], [5, 2],
	[2, 3], [3, 3], [4, 3], [5, 3], [6, 3],
	[0, 4], [2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [8, 4],
	[2, 5], [3, 5], [4, 5], [5, 5], [6, 5],
	[3, 6], [4, 6], [5, 6],
	[1, 7], [7, 7],
	[4, 8]
];
export const SUN_W = 9;

// --- pixel balloon (PixelMap buildBalloonTex) -----------------------------------------------
const BALLOON_HALF = [2, 3, 4, 5, 6, 7, 7, 7, 7, 6, 6, 5, 5, 4, 4, 3, 3, 2, 1];
const BALLOON_SEAMS = [4, 7, 10];
export function buildBalloonTex() {
	const cx = 7;
	const envH = BALLOON_HALF.length;
	const c = createCanvas(15, envH + 6);
	const ctx = c.getContext('2d');
	const W1 = '#ffffff';
	const W2 = '#c4ccd4';
	const W3 = '#e2e7ec';
	BALLOON_HALF.forEach((h, y) => {
		for (let x = cx - h; x <= cx + h; x++) {
			let col = W1;
			if (x === cx - h || x === cx + h || BALLOON_SEAMS.includes(x)) col = W2;
			else if (x > cx && ((x + y) & 1) === 0) col = W3;
			ctx.fillStyle = col;
			ctx.fillRect(x, y, 1, 1);
		}
	});
	ctx.fillStyle = W2;
	for (const y of [envH, envH + 1]) {
		ctx.fillRect(cx - 1, y, 1, 1);
		ctx.fillRect(cx + 1, y, 1, 1);
	}
	for (let y = envH + 2; y <= envH + 4; y++) {
		for (let x = cx - 1; x <= cx + 1; x++) {
			ctx.fillStyle = y === envH + 2 ? W1 : W2;
			ctx.fillRect(x, y, 1, 1);
		}
	}
	return c;
}

// --- data read (prefer baked, fall back to committed sample) ----------------------------------
export function makeReadView(root) {
	return function readView(rel) {
		for (const dir of ['static/baked', 'static/sample']) {
			const p = resolve(root, dir, rel);
			if (existsSync(p)) {
				try {
					return JSON.parse(readFileSync(p, 'utf8'));
				} catch {
					/* fall through */
				}
			}
		}
		return null;
	};
}
