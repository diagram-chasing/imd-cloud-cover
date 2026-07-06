// Rasterize the India land polygons onto the cell grid (1px = 1 cell).
import { geoPath, type GeoProjection } from 'd3-geo';
import type { FeatureCollection } from 'geojson';

export interface LandRaster {
	cols: number;
	rows: number;
	/** land[y*cols + x] = 1 if the cell is land. */
	land: Uint8Array;
	/** coastline cells: land cells with >=1 non-land 4-neighbour. */
	coast: Set<number>;
}

function makeCanvas(w: number, h: number): { ctx: CanvasRenderingContext2D; get: () => ImageData } {
	if (typeof OffscreenCanvas !== 'undefined') {
		const c = new OffscreenCanvas(w, h);
		const ctx = c.getContext('2d', { willReadFrequently: true }) as unknown as CanvasRenderingContext2D;
		return { ctx, get: () => ctx.getImageData(0, 0, w, h) };
	}
	const c = document.createElement('canvas');
	c.width = w;
	c.height = h;
	const ctx = c.getContext('2d', { willReadFrequently: true })!;
	return { ctx, get: () => ctx.getImageData(0, 0, w, h) };
}

/**
 * Draw land at 1px-per-cell and classify each cell as land (alpha > 127).
 * The projection must already be fit to frame dimensions of cols*CELL x rows*CELL,
 * so we scale it down by CELL onto the low-res raster canvas.
 */
export function rasterizeLand(
	india: FeatureCollection,
	projection: GeoProjection,
	cols: number,
	rows: number,
	cell: number
): LandRaster {
	const { ctx, get } = makeCanvas(cols, rows);
	ctx.clearRect(0, 0, cols, rows);
	ctx.save();
	ctx.scale(1 / cell, 1 / cell); // project into frame px, render into cell px
	const path = geoPath(projection, ctx);
	ctx.beginPath();
	path(india);
	ctx.fillStyle = '#000';
	ctx.fill();
	ctx.restore();

	const data = get().data;
	const land = new Uint8Array(cols * rows);
	for (let i = 0; i < cols * rows; i++) {
		if (data[i * 4 + 3] > 127) land[i] = 1;
	}

	const coast = new Set<number>();
	for (let y = 0; y < rows; y++) {
		for (let x = 0; x < cols; x++) {
			const idx = y * cols + x;
			if (!land[idx]) continue;
			const up = y > 0 ? land[idx - cols] : 0;
			const dn = y < rows - 1 ? land[idx + cols] : 0;
			const lf = x > 0 ? land[idx - 1] : 0;
			const rt = x < cols - 1 ? land[idx + 1] : 0;
			if (!up || !dn || !lf || !rt) coast.add(idx);
		}
	}

	return { cols, rows, land, coast };
}
