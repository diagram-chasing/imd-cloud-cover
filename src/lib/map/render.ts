// Pure canvas rendering for the pixel map layers. All coordinates are logical px.
import {
	SKY_RAMP,
	SKY_BANDS,
	HORIZON_STEPS,
	HORIZON_FRACTION,
	landForStep,
	coverTier,
	UI,
	type BandKey
} from '$lib/theme';
import { lerpHex } from './color';
import type { LandRaster } from './raster';
import { buildAtlas, BAND_OFFSET, type SpriteAtlas } from './sprites';
import type { StationPoint } from './hit';
import type { Star } from './stars';
import { CLEAR_STARS } from '$lib/theme';

export type BandValues = Record<string, { h: number; m: number; l: number }>;
export interface BandFlags {
	high: boolean;
	middle: boolean;
	low: boolean;
}

const BAND_KEYS: BandKey[] = ['high', 'middle', 'low'];
const VAL_KEY: Record<BandKey, 'h' | 'm' | 'l'> = { high: 'h', middle: 'm', low: 'l' };

export function drawBase(
	ctx: CanvasRenderingContext2D,
	opts: {
		cols: number;
		rows: number;
		cell: number;
		frameW: number;
		frameH: number;
		timeIndex: number;
		raster: LandRaster;
		stars?: Star[];
		values?: BandValues;
		points?: StationPoint[];
	}
) {
	const { cols, rows, cell, frameW, frameH, timeIndex, raster } = opts;
	const stop = SKY_RAMP[timeIndex];

	// Sky: quantized horizontal bands top -> bottom.
	const bandH = frameH / SKY_BANDS;
	for (let i = 0; i < SKY_BANDS; i++) {
		ctx.fillStyle = lerpHex(stop.top, stop.bottom, i / (SKY_BANDS - 1));
		ctx.fillRect(0, Math.floor(i * bandH), frameW, Math.ceil(bandH) + 1);
	}
	// Dawn/dusk: solid peach horizon along the bottom.
	if (HORIZON_STEPS.has(timeIndex)) {
		ctx.fillStyle = stop.bottom;
		ctx.fillRect(0, Math.floor(frameH * (1 - HORIZON_FRACTION)), frameW, frameH);
	}

	// Stars (night steps only): drawn on the base layer, over the sky, under land.
	if (stop.mode === 'night' && opts.stars && opts.stars.length) {
		drawStars(ctx, opts.stars, opts.values, opts.points, cell);
	}

	// Land: 2x2 checker of fill/dither; coastline cells use the dither color.
	const { fill, dither } = landForStep(timeIndex);
	const { land, coast } = raster;
	for (let y = 0; y < rows; y++) {
		for (let x = 0; x < cols; x++) {
			const idx = y * cols + x;
			if (!land[idx]) continue;
			ctx.fillStyle = coast.has(idx) ? dither : (x + y) & 1 ? dither : fill;
			ctx.fillRect(x * cell, y * cell, cell, cell);
		}
	}
}

function drawStars(
	ctx: CanvasRenderingContext2D,
	stars: Star[],
	values: BandValues | undefined,
	points: StationPoint[] | undefined,
	cell: number
) {
	ctx.save();
	for (const star of stars) {
		if (star.hidden) continue;
		// Star shows only where the nearest station is clear, or none is near.
		if (values && points && !clearAt(star.x, star.y, values, points, cell)) continue;
		ctx.globalAlpha = 0.9;
		ctx.fillStyle = '#FFFFFF';
		ctx.fillRect(star.x, star.y, cell, cell);
		if (star.plus) {
			ctx.fillRect(star.x - cell, star.y, cell, cell);
			ctx.fillRect(star.x + cell, star.y, cell, cell);
			ctx.fillRect(star.x, star.y - cell, cell, cell);
			ctx.fillRect(star.x, star.y + cell, cell, cell);
		}
	}
	ctx.globalAlpha = 1;
	ctx.restore();
}

function clearAt(
	x: number,
	y: number,
	values: BandValues,
	points: StationPoint[],
	cell: number,
	radiusPx = 80
): boolean {
	let best = Infinity;
	let bestCode: string | null = null;
	for (const p of points) {
		const dx = p.x - x;
		const dy = p.y - y;
		const d = dx * dx + dy * dy;
		if (d < best) {
			best = d;
			bestCode = p.code;
		}
	}
	if (bestCode === null || best > radiusPx * radiusPx) return true; // no station near
	const v = values[bestCode];
	if (!v) return true;
	return Math.max(v.h, v.m, v.l) < CLEAR_STARS;
}

export function drawClouds(
	ctx: CanvasRenderingContext2D,
	opts: {
		points: StationPoint[];
		values: BandValues;
		bands: BandFlags;
		atlas: SpriteAtlas;
		cell: number;
		frameW: number;
		frameH: number;
		driftTick?: number;
	}
) {
	const { points, values, bands, atlas, cell, frameW, frameH } = opts;
	ctx.clearRect(0, 0, frameW, frameH);
	ctx.imageSmoothingEnabled = false;

	// Draw per band so parallax layering reads consistently; within a band the
	// points are already north-first sorted so southern clouds overdraw northern.
	for (const band of BAND_KEYS) {
		if (!bands[band]) continue;
		const isHighDrift = band === 'high' && opts.driftTick != null;
		const driftCells = isHighDrift ? opts.driftTick! % 4 : 0;
		for (const p of points) {
			const v = values[p.code];
			if (!v) continue;
			const cover = v[VAL_KEY[band]];
			const tier = coverTier(cover);
			if (tier === 0) continue;
			const sprite = atlas.get(band, tier);
			const bodyRows = sprite.hCells - sprite.shadowRows;
			const topCellX = p.cellX - Math.floor(sprite.wCells / 2) + driftCells;
			const topCellY = p.cellY + BAND_OFFSET[band] - Math.floor(bodyRows / 2);
			ctx.drawImage(
				sprite.canvas,
				topCellX * cell,
				topCellY * cell,
				sprite.wCells * cell,
				sprite.hCells * cell
			);
		}
	}
}

/** 1-cell pixel-border rectangle around the hovered station's sprite extent. */
export function drawHover(
	ctx: CanvasRenderingContext2D,
	opts: {
		point: StationPoint;
		values: BandValues;
		bands: BandFlags;
		atlas: SpriteAtlas;
		cell: number;
		frameW: number;
		frameH: number;
		night: boolean;
	}
) {
	const { point, values, bands, atlas, cell, frameW, frameH, night } = opts;
	ctx.clearRect(0, 0, frameW, frameH);
	const v = values[point.code];
	if (!v) return;

	let minX = point.cellX,
		maxX = point.cellX,
		minY = point.cellY,
		maxY = point.cellY;
	for (const band of BAND_KEYS) {
		if (!bands[band]) continue;
		const tier = coverTier(v[VAL_KEY[band]]);
		if (tier === 0) continue;
		const sprite = atlas.get(band, tier);
		const bodyRows = sprite.hCells - sprite.shadowRows;
		const tX = point.cellX - Math.floor(sprite.wCells / 2);
		const tY = point.cellY + BAND_OFFSET[band] - Math.floor(bodyRows / 2);
		minX = Math.min(minX, tX);
		maxX = Math.max(maxX, tX + sprite.wCells - 1);
		minY = Math.min(minY, tY);
		maxY = Math.max(maxY, tY + sprite.hCells - 1);
	}

	const pad = 1;
	const x = (minX - pad) * cell;
	const y = (minY - pad) * cell;
	const w = (maxX - minX + 1 + pad * 2) * cell;
	const h = (maxY - minY + 1 + pad * 2) * cell;
	ctx.strokeStyle = night ? UI.focus : '#FFFFFF';
	ctx.lineWidth = cell;
	ctx.strokeRect(x + cell / 2, y + cell / 2, w - cell, h - cell);
}

export { buildAtlas };
