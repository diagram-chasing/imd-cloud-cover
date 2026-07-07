import { CLOUD, RAIN, type BandKey } from '$lib/theme';
import { fnv1a, mulberry32 } from './hash';

type Pattern = number[][];

// LOW — cumulus (Mario cloud), bright white flat base + base-shadow row.
const LOW: Pattern[] = [
	[
		[0, 1, 0],
		[1, 1, 1]
	],
	[
		[0, 1, 1, 0],
		[1, 1, 1, 1]
	],
	[
		[0, 0, 1, 1, 0],
		[0, 1, 1, 1, 1],
		[1, 1, 1, 1, 1]
	],
	[
		[0, 0, 1, 1, 0, 0],
		[0, 1, 1, 1, 1, 0],
		[1, 1, 1, 1, 1, 1],
		[1, 1, 1, 1, 1, 1]
	]
];

// MIDDLE — alto, layered puffs.
const MIDDLE: Pattern[] = [
	[[1, 1]],
	[[1, 1, 1]],
	[
		[0, 1, 1, 0],
		[1, 1, 1, 1]
	],
	[
		[0, 1, 1, 1, 0],
		[1, 1, 1, 1, 1]
	]
];

// HIGH — cirrus, thin veils (1 row except t4).
const HIGH: Pattern[] = [
	[[1, 1]],
	[[1, 1, 0, 1]],
	[[1, 1, 1, 0, 1, 1]],
	[
		[1, 1, 1, 0, 1, 1, 1],
		[0, 0, 1, 1, 1, 0, 0]
	]
];

const PATTERNS: Record<BandKey, Pattern[]> = { low: LOW, middle: MIDDLE, high: HIGH };

export interface Sprite {
	canvas: CanvasRenderingContext2D['canvas'];
	wCells: number;
	hCells: number;
	/** cells from the top of the canvas that are shadow (below the cloud body). */
	shadowRows: number;
}

export interface SpriteAtlas {
	cell: number;
	get(band: BandKey, tier: 1 | 2 | 3 | 4, variant?: number): Sprite;
}

function drawPattern(pattern: Pattern, band: BandKey, cell: number): Sprite {
	const rows = pattern.length;
	const cols = Math.max(...pattern.map((r) => r.length));
	const hasShadow = band === 'low';
	const shadowRows = hasShadow ? 1 : 0;
	const totalRows = rows + shadowRows;

	const canvas =
		typeof OffscreenCanvas !== 'undefined'
			? new OffscreenCanvas(cols * cell, totalRows * cell)
			: Object.assign(document.createElement('canvas'), {
				width: cols * cell,
				height: totalRows * cell
			});
	const ctx = (canvas as HTMLCanvasElement).getContext('2d')!;
	ctx.imageSmoothingEnabled = false;

	const conf = CLOUD[band];
	// Base-shadow row for low clouds: inset by 1 cell each side, under the body.
	if (hasShadow) {
		ctx.fillStyle = CLOUD.low.shadow;
		for (let x = 1; x < cols - 1; x++) {
			ctx.fillRect(x * cell, rows * cell, cell, cell);
		}
	}

	ctx.globalAlpha = 'alpha' in conf ? conf.alpha : 1;
	ctx.fillStyle = conf.fill;
	for (let y = 0; y < rows; y++) {
		const row = pattern[y];
		for (let x = 0; x < row.length; x++) {
			if (row[x]) ctx.fillRect(x * cell, y * cell, cell, cell);
		}
	}
	ctx.globalAlpha = 1;

	return { canvas: canvas as HTMLCanvasElement, wCells: cols, hCells: totalRows, shadowRows };
}

/** Build (or rebuild on resize) the sprite atlas for a given cell size. */
export function buildAtlas(cell: number): SpriteAtlas {
	const cache = new Map<string, Sprite>();
	for (const band of ['low', 'middle', 'high'] as BandKey[]) {
		PATTERNS[band].forEach((pat, i) => {
			cache.set(`${band}:${i + 1}`, drawPattern(pat, band, cell));
		});
	}
	return {
		cell,
		get: (band, tier) => cache.get(`${band}:${tier}`)!
	};
}

// --- Tower-mark cloud glyphs -----------------------------------------------
// Each station is a small pixel cloud, generated procedurally so it reads as an
// organic puff rather than a symmetric block, and so we can mint several
// variations per species — the map would look mechanical if every station drew
// the identical glyph. Three distinct species so a tower reads at a glance:
//   HIGH   cirrus — thin, broken, wind-drifted streaks (ice blue).
//   MIDDLE alto   — a low, wide, lumpy sheet (blue-grey).
//   LOW    cumulus— a fat, lobed puff with a flat, shaded base (white).
// Cover (tier 1-4) grows each glyph. Shape variety comes from a seeded PRNG, so
// the render stays identical across loads (no Math.random in the render path).

/** Number of shape variations minted per species + tier. */
export const MARK_VARIANTS = 3;

// Per-tier footprint in logical cells: [width, maxRows]. Cumulus stays compact
// (<= 3 rows) so a whole tower still fits the bin; alto is deliberately flatter
// and wider so it never reads as a cumulus puff.
const SIZES: Record<'low' | 'middle', [number, number][]> = {
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
const HIGH_W = [3, 5, 7, 9]; // cirrus streak width per tier (always 2 rows)

// Per-band alpha for tower marks. High is bumped vs the flat CLOUD.high so the
// separated top mark stays legible against both sky and land.
const MARK_ALPHA: Record<BandKey, number> = { high: 0.8, middle: 0.95, low: 1 };

// Cover tier → luminance ramp. Size alone barely separates tiers when zoomed
// out, so we also fade low-cover marks and drive high-cover ones to full
// opacity. This is the dominant cue: dense regions visibly glow, sparse ones
// recede, and spatial patterns read at any zoom. Indexed by tier-1 (tiers 1-4).
const TIER_ALPHA = [0.42, 0.6, 0.82, 1];

/** A bumpy-topped, flat-bottomed height profile → the body of a puff cloud. */
function puffProfile(rand: () => number, w: number, maxH: number, rough: number): number[] {
	// Peak wanders off-centre for asymmetry; height falls off toward the edges.
	const peak = 0.5 + (rand() - 0.5) * 0.7;
	const h: number[] = [];
	for (let x = 0; x < w; x++) {
		const t = w > 1 ? x / (w - 1) : 0.5;
		const d = Math.abs(t - peak) / Math.max(peak, 1 - peak); // 0 at peak → 1 at far edge
		const arch = Math.cos((d * Math.PI) / 2); // smooth dome
		h.push(Math.round(arch * maxH + (rand() - 0.5) * rough));
	}
	// Keep the interior grounded (a solid, gap-free base) but round the outer
	// corners so the silhouette isn't a hard rectangle.
	for (let x = 1; x < w - 1; x++) h[x] = Math.max(1, Math.min(maxH, h[x]));
	h[0] = Math.max(0, Math.min(1, h[0]));
	h[w - 1] = Math.max(0, Math.min(1, h[w - 1]));
	return h;
}

/** Fill each column from the flat base up to its profile height. */
function profileToPattern(heights: number[], rows: number): Pattern {
	const w = heights.length;
	const grid: number[][] = Array.from({ length: rows }, () => new Array(w).fill(0));
	for (let x = 0; x < w; x++) {
		for (let y = rows - heights[x]; y < rows; y++) if (y >= 0) grid[y][x] = 1;
	}
	return grid;
}

/** Thin, broken, drifting streaks — cirrus never looks solid. */
function cirrusPattern(rand: () => number, w: number): Pattern {
	const grid: number[][] = [new Array(w).fill(0), new Array(w).fill(0)];
	let x = 0;
	let drew = false;
	while (x < w) {
		if (rand() < 0.78) {
			const len = 2 + Math.floor(rand() * 2); // 2-3 cell dash
			const y = rand() < 0.5 ? 0 : 1; // which row it drifts along
			for (let i = 0; i < len && x + i < w; i++) grid[y][x + i] = 1;
			drew = true;
			x += len + 1 + Math.floor(rand() * 2); // gap before the next wisp
		} else {
			x += 1 + Math.floor(rand() * 2);
		}
	}
	if (!drew) grid[0][0] = grid[0][Math.min(1, w - 1)] = 1; // never fully empty
	return grid;
}

function makePattern(band: BandKey, tier: number, variant: number): Pattern {
	const rand = mulberry32(fnv1a(`${band}:${tier}:${variant}`));
	if (band === 'high') return cirrusPattern(rand, HIGH_W[tier - 1]);
	const [w, maxH] = SIZES[band][tier - 1];
	const rough = band === 'low' ? 1.5 : 0.9; // cumulus is lumpier than the alto sheet
	return profileToPattern(puffProfile(rand, w, maxH, rough), maxH);
}

function drawMark(pattern: Pattern, band: BandKey, tier: number, cell: number): Sprite {
	const rows = pattern.length;
	const cols = Math.max(...pattern.map((r) => r.length));

	const canvas =
		typeof OffscreenCanvas !== 'undefined'
			? new OffscreenCanvas(cols * cell, rows * cell)
			: Object.assign(document.createElement('canvas'), {
				width: cols * cell,
				height: rows * cell
			});
	const ctx = (canvas as HTMLCanvasElement).getContext('2d')!;
	ctx.imageSmoothingEnabled = false;

	ctx.globalAlpha = MARK_ALPHA[band] * TIER_ALPHA[tier - 1];
	ctx.fillStyle = CLOUD[band].fill;
	for (let y = 0; y < rows; y++) {
		const row = pattern[y];
		for (let x = 0; x < cols; x++) {
			if (row[x]) ctx.fillRect(x * cell, y * cell, cell, cell);
		}
	}

	// Cumulus depth: shade the bottom-most filled cell of each column so the puff
	// sits on a grounded base instead of reading as a flat sticker. Skip the
	// smallest (2-row) tier where a shaded row would swallow the whole glyph.
	if (band === 'low' && rows >= 3) {
		ctx.fillStyle = CLOUD.low.shadow;
		for (let x = 0; x < cols; x++) {
			let by = -1;
			for (let y = 0; y < rows; y++) if (pattern[y][x]) by = y;
			if (by >= 0) ctx.fillRect(x * cell, by * cell, cell, cell);
		}
	}
	ctx.globalAlpha = 1;

	return { canvas: canvas as HTMLCanvasElement, wCells: cols, hCells: rows, shadowRows: 0 };
}

// --- Rain streaks ----------------------------------------------------------
// A small curtain of falling streaks that hangs beneath the low cloud where the
// forecast shows precip. Kept deliberately sparse and thin (1-cell-wide dashes)
// so it reads as rain, not a solid block, and so it never fights the cumulus
// above it. Three tiers (drizzle / rain / heavy) widen the curtain and add
// streaks; a seeded PRNG mints variants so neighbouring stations don't rhyme.

// Per rain tier: [width in cells, rows tall, streak density 0..1].
const RAIN_SIZE: [number, number, number][] = [
	[4, 3, 0.5], // 1 drizzle
	[6, 4, 0.7], // 2 rain
	[7, 5, 0.85] // 3 heavy
];

export interface RainAtlas {
	cell: number;
	get(tier: 1 | 2 | 3, variant?: number): Sprite;
}

/** Staggered vertical dashes → a curtain of falling rain. */
function rainPattern(rand: () => number, tier: number): Pattern {
	const [w, rows, density] = RAIN_SIZE[tier - 1];
	const grid: number[][] = Array.from({ length: rows }, () => new Array(w).fill(0));
	let drew = false;
	for (let x = 0; x < w; x++) {
		if (rand() >= density) continue;
		const len = 1 + Math.floor(rand() * 2); // 1-2 cell dash
		const start = Math.floor(rand() * (rows - len + 1)); // staggered vertical offset
		for (let i = 0; i < len; i++) grid[start + i][x] = 1;
		drew = true;
	}
	if (!drew) grid[0][Math.floor(w / 2)] = 1; // never fully empty
	return grid;
}

function drawRainMark(pattern: Pattern, tier: number, cell: number): Sprite {
	const rows = pattern.length;
	const cols = Math.max(...pattern.map((r) => r.length));

	const canvas =
		typeof OffscreenCanvas !== 'undefined'
			? new OffscreenCanvas(cols * cell, rows * cell)
			: Object.assign(document.createElement('canvas'), {
				width: cols * cell,
				height: rows * cell
			});
	const ctx = (canvas as HTMLCanvasElement).getContext('2d')!;
	ctx.imageSmoothingEnabled = false;

	// Heavier tiers deepen the blue and firm up; drizzle stays translucent.
	ctx.globalAlpha = [0.7, 0.85, 1][tier - 1];
	ctx.fillStyle = tier >= 3 ? RAIN.deep : RAIN.fill;
	for (let y = 0; y < rows; y++) {
		const row = pattern[y];
		for (let x = 0; x < cols; x++) {
			if (row[x]) ctx.fillRect(x * cell, y * cell, cell, cell);
		}
	}
	ctx.globalAlpha = 1;

	return { canvas: canvas as HTMLCanvasElement, wCells: cols, hCells: rows, shadowRows: 0 };
}

/** Build the rain-streak atlas: 3 tiers x MARK_VARIANTS shapes. */
export function buildRainAtlas(cell: number): RainAtlas {
	const cache = new Map<string, Sprite>();
	for (let tier = 1; tier <= 3; tier++) {
		for (let v = 0; v < MARK_VARIANTS; v++) {
			const rand = mulberry32(fnv1a(`rain:${tier}:${v}`));
			cache.set(`${tier}:${v}`, drawRainMark(rainPattern(rand, tier), tier, cell));
		}
	}
	return {
		cell,
		get: (tier, variant = 0) => cache.get(`${tier}:${variant % MARK_VARIANTS}`)!
	};
}

/** Build the tower-mark atlas: 3 bands x 4 tiers x MARK_VARIANTS shapes. */
export function buildMarkAtlas(cell: number): SpriteAtlas {
	const cache = new Map<string, Sprite>();
	for (const band of ['low', 'middle', 'high'] as BandKey[]) {
		for (let tier = 1; tier <= 4; tier++) {
			for (let v = 0; v < MARK_VARIANTS; v++) {
				cache.set(`${band}:${tier}:${v}`, drawMark(makePattern(band, tier, v), band, tier, cell));
			}
		}
	}
	return {
		cell,
		get: (band, tier, variant = 0) => cache.get(`${band}:${tier}:${variant % MARK_VARIANTS}`)!
	};
}
