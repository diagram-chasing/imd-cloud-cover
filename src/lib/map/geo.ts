// Geographic geometry for the Pixi map: project India, rasterize the ground at
// cell resolution, and list station positions in projected (px, py) space. The
// oblique "from the side" tilt + cloud altitudes are applied in the Pixi layer.
import { geoConicConformal, geoPath, type GeoProjection } from 'd3-geo';
import type { FeatureCollection, Feature, Geometry } from 'geojson';
import { landForStep, urbanForStep, riverForStep } from '$lib/theme';
import { jitter } from './hash';
import type { StationsManifest } from '$lib/types';

export interface GeoStation {
	code: string;
	px: number; // projected world px (unsquashed)
	py: number;
}

export interface GeoPlace {
	name: string;
	pop: number;
	px: number; // projected world px (unsquashed)
	py: number;
}

export interface Geo {
	cell: number;
	/** World px per ground raster pixel — the sprite scale for renderGround(). */
	groundScale: number;
	cols: number;
	rows: number;
	worldW: number;
	worldH: number; // natural (unsquashed) projected height
	land: Uint8Array;
	urban: Uint8Array;
	river: Uint8Array;
	coast: Set<number>;
	stations: GeoStation[];
	places: GeoPlace[];
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
	cell: number,
	urbanFC?: FeatureCollection,
	placesFC?: FeatureCollection,
	riversFC?: FeatureCollection
): Geo {
	const worldH = worldW * 1.06;
	// The cloud/station grid works in whole `cell` units, but the ground (coast +
	// built-up patches) reads too blocky at that resolution — so rasterize the
	// ground on a finer sub-grid and scale the sprite back down.
	const DETAIL = 2; // ground sub-cells per cloud cell
	const gcell = cell / DETAIL;
	const cols = Math.floor(worldW / gcell);
	const rows = Math.floor(worldH / gcell);

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

	// Rasterize land at 1px = 1 ground sub-cell.
	const rctx = makeCanvas(cols, rows).getContext('2d', { willReadFrequently: true })!;
	rctx.save();
	rctx.scale(1 / gcell, 1 / gcell);
	const path = geoPath(projection, rctx);
	rctx.beginPath();
	path(india);
	rctx.fillStyle = '#000';
	rctx.fill();
	rctx.restore();

	const px = rctx.getImageData(0, 0, cols, rows).data;
	const land = new Uint8Array(cols * rows);
	for (let i = 0; i < cols * rows; i++) if (px[i * 4 + 3] > 127) land[i] = 1;

	// Built-up areas: rasterize the (already India-clipped) urban polygons with the
	// same projection, keep only cells that are also land so coastal cities never
	// bleed into the sea. Many Indian towns are still smaller than a ground
	// sub-cell, so supersample and mark a cell built-up once any of its sub-samples
	// are covered, so the finer 10m town set actually reads.
	const urban = new Uint8Array(cols * rows);
	if (urbanFC) {
		const SS = 2; // extra sub-samples per axis on top of the ground grid
		const NEED = 1; // sub-samples covered before a cell counts as built-up
		const sw = cols * SS;
		const sh = rows * SS;
		const uctx = makeCanvas(sw, sh).getContext('2d', { willReadFrequently: true })!;
		uctx.save();
		uctx.scale(SS / gcell, SS / gcell);
		const upath = geoPath(projection, uctx);
		uctx.beginPath();
		upath(urbanFC);
		uctx.fillStyle = '#000';
		uctx.fill();
		uctx.restore();
		const upx = uctx.getImageData(0, 0, sw, sh).data;
		for (let y = 0; y < rows; y++) {
			for (let x = 0; x < cols; x++) {
				const idx = y * cols + x;
				if (!land[idx]) continue;
				let hit = 0;
				for (let sy = 0; sy < SS && hit < NEED; sy++) {
					for (let sx = 0; sx < SS; sx++) {
						if (upx[((y * SS + sy) * sw + (x * SS + sx)) * 4 + 3] > 127) {
							if (++hit >= NEED) break;
						}
					}
				}
				if (hit >= NEED) urban[idx] = 1;
			}
		}
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

	// Major rivers: stroke the (India-clipped) centerlines one sub-cell wide and
	// keep the cells that fall on land, so a river never draws out in the sea.
	// Painted a muted blue in renderGround.
	const river = new Uint8Array(cols * rows);
	if (riversFC) {
		const vctx = makeCanvas(cols, rows).getContext('2d', { willReadFrequently: true })!;
		vctx.save();
		vctx.scale(1 / gcell, 1 / gcell);
		const vpath = geoPath(projection, vctx);
		vctx.beginPath();
		vpath(riversFC);
		vctx.lineJoin = 'round';
		vctx.lineCap = 'round';
		vctx.lineWidth = gcell; // → 1 sub-cell wide
		vctx.strokeStyle = '#000';
		vctx.stroke();
		vctx.restore();
		const vpx = vctx.getImageData(0, 0, cols, rows).data;
		for (let i = 0; i < cols * rows; i++) if (land[i] && vpx[i * 4 + 3] > 100) river[i] = 1;
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

	// Project the limited city set into world px. Coordinates are [lon, lat].
	const places: GeoPlace[] = [];
	if (placesFC) {
		for (const f of placesFC.features) {
			if (f.geometry?.type !== 'Point') continue;
			const [lon, lat] = f.geometry.coordinates as [number, number];
			const p = projection([lon, lat]);
			if (!p) continue;
			places.push({
				name: String(f.properties?.name ?? ''),
				pop: Number(f.properties?.pop ?? 0),
				px: p[0],
				py: p[1]
			});
		}
	}

	function renderGround(timeIndex: number): HTMLCanvasElement {
		const c = makeCanvas(cols, rows);
		const ctx = c.getContext('2d')!;
		const land0 = landForStep(timeIndex);
		const urban0 = urbanForStep(timeIndex);
		const img = ctx.createImageData(cols, rows);
		const lRGB = hexRGB(land0.fill);
		const ldRGB = hexRGB(land0.dither);
		const uRGB = hexRGB(urban0.fill);
		const udRGB = hexRGB(urban0.dither);
		const rvRGB = hexRGB(riverForStep(timeIndex));
		const RIVER_A = 0.4; // river ink opacity — blended over the ground, not solid
		for (let y = 0; y < rows; y++) {
			for (let x = 0; x < cols; x++) {
				const idx = y * cols + x;
				if (!land[idx]) continue;
				const useD = coast.has(idx) || (x + y) & 1;
				const built = urban[idx] === 1;
				const base = built ? (useD ? udRGB : uRGB) : useD ? ldRGB : lRGB;
				const o = idx * 4;
				// Rivers draw over land + built-up cells as a translucent blue thread,
				// blended with the ground beneath so they never overpower it.
				if (river[idx]) {
					img.data[o] = base[0] + (rvRGB[0] - base[0]) * RIVER_A;
					img.data[o + 1] = base[1] + (rvRGB[1] - base[1]) * RIVER_A;
					img.data[o + 2] = base[2] + (rvRGB[2] - base[2]) * RIVER_A;
				} else {
					img.data[o] = base[0];
					img.data[o + 1] = base[1];
					img.data[o + 2] = base[2];
				}
				img.data[o + 3] = 255;
			}
		}
		ctx.putImageData(img, 0, 0);
		return c;
	}

	return {
		cell,
		groundScale: gcell,
		cols,
		rows,
		worldW,
		worldH,
		land,
		urban,
		river,
		coast,
		stations,
		places,
		renderGround
	};
}

function hexRGB(hex: string): [number, number, number] {
	const h = hex.replace('#', '');
	return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
