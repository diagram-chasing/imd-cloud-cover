import { CLOUD, type BandKey } from '$lib/theme';
import { fnv1a, mulberry32 } from './hash';

type Pattern = number[][];

export interface Sprite {
	canvas: CanvasRenderingContext2D['canvas'];
	wCells: number;
	hCells: number;
	shadowRows: number;
}

export interface SpriteAtlas {
	cell: number;
	get(band: BandKey, tier: 1 | 2 | 3 | 4, variant?: number): Sprite;
}

export const MARK_VARIANTS = 3;

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
const HIGH_W = [3, 5, 7, 9];
export const MARK_ALPHA: Record<BandKey, number> = { high: 0.55, middle: 0.95, low: 1 };
export const TIER_ALPHA = [0.42, 0.6, 0.82, 1];

function puffProfile(rand: () => number, w: number, maxH: number, rough: number): number[] {
	const peak = 0.5 + (rand() - 0.5) * 0.7;
	const h: number[] = [];
	for (let x = 0; x < w; x++) {
		const t = w > 1 ? x / (w - 1) : 0.5;
		const d = Math.abs(t - peak) / Math.max(peak, 1 - peak); // 0 at peak → 1 at far edge
		const arch = Math.cos((d * Math.PI) / 2);
		h.push(Math.round(arch * maxH + (rand() - 0.5) * rough));
	}

	for (let x = 1; x < w - 1; x++) h[x] = Math.max(1, Math.min(maxH, h[x]));
	h[0] = Math.max(0, Math.min(1, h[0]));
	h[w - 1] = Math.max(0, Math.min(1, h[w - 1]));
	return h;
}

function profileToPattern(heights: number[], rows: number): Pattern {
	const w = heights.length;
	const grid: number[][] = Array.from({ length: rows }, () => new Array(w).fill(0));
	for (let x = 0; x < w; x++) {
		for (let y = rows - heights[x]; y < rows; y++) if (y >= 0) grid[y][x] = 1;
	}
	return grid;
}

function cirrusPattern(rand: () => number, w: number): Pattern {
	const grid: number[][] = [new Array(w).fill(0), new Array(w).fill(0)];
	let x = 0;
	let drew = false;
	while (x < w) {
		if (rand() < 0.62) {
			const len = 1 + Math.floor(rand() * 2); // 1-2 cell dash — shorter wisps
			const y = rand() < 0.5 ? 0 : 1;
			for (let i = 0; i < len && x + i < w; i++) grid[y][x + i] = 1;
			drew = true;
			x += len + 2 + Math.floor(rand() * 2); // wider gap before the next wisp
		} else {
			x += 1 + Math.floor(rand() * 2);
		}
	}
	if (!drew) grid[0][0] = grid[0][Math.min(1, w - 1)] = 1; // never fully empty
	return grid;
}

export function makePattern(band: BandKey, tier: number, variant: number): Pattern {
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
