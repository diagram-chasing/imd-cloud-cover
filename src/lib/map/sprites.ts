// Cloud sprites: literal 0/1 pixel patterns pre-rendered into an offscreen atlas
// at the current CELL size. Three species (low/middle/high) x 4 tiers.
import { CLOUD, type BandKey } from '$lib/theme';

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
	get(band: BandKey, tier: 1 | 2 | 3 | 4): Sprite;
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
