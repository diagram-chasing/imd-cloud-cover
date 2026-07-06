// Geographic geometry for the Pixi map: project India, rasterize the ground at
// cell resolution, and list station positions in projected (px, py) space. The
// oblique "from the side" tilt + cloud altitudes are applied in the Pixi layer.
import { geoConicConformal, geoPath, type GeoProjection } from 'd3-geo';
import type { FeatureCollection, Feature, Geometry } from 'geojson';
import { landForStep } from '$lib/theme';
import { jitter } from './hash';
import type { StationsManifest } from '$lib/types';

export interface GeoStation {
	code: string;
	px: number; // projected world px (unsquashed)
	py: number;
}

export interface Geo {
	cell: number;
	cols: number;
	rows: number;
	worldW: number;
	worldH: number; // natural (unsquashed) projected height
	land: Uint8Array;
	coast: Set<number>;
	stations: GeoStation[];
	/** Render the ground tile-map to a cell-resolution canvas for a sky mode. */
	renderGround(timeIndex: number): HTMLCanvasElement;
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
	const c = document.createElement('canvas');
	c.width = w;
	c.height = h;
	return c;
}

export function buildGeo(
	india: FeatureCollection,
	manifest: StationsManifest,
	worldW: number,
	cell: number
): Geo {
	const worldH = worldW * 1.06;
	const cols = Math.floor(worldW / cell);
	const rows = Math.floor(worldH / cell);

	const projection: GeoProjection = geoConicConformal()
		.parallels([12, 36])
		.rotate([-82.5, 0])
		.fitExtent(
			[
				[cell, cell],
				[worldW - cell, worldH - cell]
			],
			india as unknown as Feature<Geometry>
		);

	// Rasterize land at 1px = 1 cell.
	const rctx = makeCanvas(cols, rows).getContext('2d', { willReadFrequently: true })!;
	rctx.save();
	rctx.scale(1 / cell, 1 / cell);
	const path = geoPath(projection, rctx);
	rctx.beginPath();
	path(india);
	rctx.fillStyle = '#000';
	rctx.fill();
	rctx.restore();

	const px = rctx.getImageData(0, 0, cols, rows).data;
	const land = new Uint8Array(cols * rows);
	for (let i = 0; i < cols * rows; i++) if (px[i * 4 + 3] > 127) land[i] = 1;

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

	const stations: GeoStation[] = [];
	for (const [code, s] of Object.entries(manifest.stations)) {
		const p = projection([s.lon, s.lat]);
		if (!p) continue;
		let cx = Math.floor(p[0] / cell) + jitter(code, 'x', 1);
		let cy = Math.floor(p[1] / cell) + jitter(code, 'y', 1);
		cx = Math.max(0, Math.min(cols - 1, cx));
		cy = Math.max(0, Math.min(rows - 1, cy));
		stations.push({ code, px: cx * cell + cell / 2, py: cy * cell + cell / 2 });
	}

	function renderGround(timeIndex: number): HTMLCanvasElement {
		const c = makeCanvas(cols, rows);
		const ctx = c.getContext('2d')!;
		const { fill, dither } = landForStep(timeIndex);
		const img = ctx.createImageData(cols, rows);
		const fRGB = hexRGB(fill);
		const dRGB = hexRGB(dither);
		for (let y = 0; y < rows; y++) {
			for (let x = 0; x < cols; x++) {
				const idx = y * cols + x;
				if (!land[idx]) continue;
				const useD = coast.has(idx) || (x + y) & 1;
				const rgb = useD ? dRGB : fRGB;
				const o = idx * 4;
				img.data[o] = rgb[0];
				img.data[o + 1] = rgb[1];
				img.data[o + 2] = rgb[2];
				img.data[o + 3] = 255;
			}
		}
		ctx.putImageData(img, 0, 0);
		return c;
	}

	return { cell, cols, rows, worldW, worldH, land, coast, stations, renderGround };
}

function hexRGB(hex: string): [number, number, number] {
	const h = hex.replace('#', '');
	return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
