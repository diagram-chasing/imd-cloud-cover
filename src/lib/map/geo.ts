// Geographic geometry for the Pixi map: project India, rasterize the ground at
// cell resolution, and list station positions in projected (px, py) space. The
// oblique "from the side" tilt + cloud altitudes are applied in the Pixi layer.
import { geoConicConformal, geoPath, type GeoProjection } from 'd3-geo';
import type { FeatureCollection, Feature, Geometry } from 'geojson';
import { landForStep, urbanForStep } from '$lib/theme';
import { jitter } from './hash';
import type { StationsManifest } from '$lib/types';

export interface GeoStation {
	code: string;
	px: number; // projected world px (unsquashed), snapped to the CELL grid
	py: number;
	rpx: number; // raw projected world px (unsnapped) — LOD binning uses these so
	rpy: number; // aggregation is driven by the bin grid, not the legacy CELL snap
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
	coast: Set<number>;
	stations: GeoStation[];
	places: GeoPlace[];
	/** Project a lon/lat into world px with the map's projection (may be off-map). */
	project(lon: number, lat: number): [number, number] | null;
	/** Render the ground tile-map to a cell-resolution canvas for a sky mode. */
	renderGround(timeIndex: number): HTMLCanvasElement;
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
	const c = document.createElement('canvas');
	c.width = w;
	c.height = h;
	return c;
}

// A decoded ground tile: raw RGBA plus the mean colour of its opaque pixels.
// renderGround tints each tile by scaling its pixels so this mean lands exactly
// on the theme's land/urban colour — the tile keeps the current flat palette but
// gains texture, and still darkens at night because the target colour does.
export interface GroundTile {
	data: Uint8ClampedArray;
	w: number;
	h: number;
	mean: [number, number, number];
}

function loadImage(url: string): Promise<HTMLImageElement> {
	return new Promise((res, rej) => {
		const im = new Image();
		im.onload = () => res(im);
		im.onerror = rej;
		im.src = url;
	});
}

// Decode a set of tile URLs into samplable RGBA + mean colour. Failures resolve
// to an empty list so the map falls back to flat land fills (renderGround guards).
export async function loadGroundTiles(urls: string[]): Promise<GroundTile[]> {
	const imgs = await Promise.all(urls.map(loadImage));
	return imgs.map((img) => {
		const w = img.naturalWidth;
		const h = img.naturalHeight;
		const ctx = makeCanvas(w, h).getContext('2d', { willReadFrequently: true })!;
		ctx.drawImage(img, 0, 0);
		const data = ctx.getImageData(0, 0, w, h).data;
		let r = 0;
		let g = 0;
		let b = 0;
		let n = 0;
		for (let i = 0; i < w * h; i++) {
			if (data[i * 4 + 3] > 127) {
				r += data[i * 4];
				g += data[i * 4 + 1];
				b += data[i * 4 + 2];
				n++;
			}
		}
		n = n || 1;
		return { data, w, h, mean: [r / n, g / n, b / n] as [number, number, number] };
	});
}

export function buildGeo(
	india: FeatureCollection,
	manifest: StationsManifest,
	worldW: number,
	cell: number,
	urbanFC?: FeatureCollection,
	placesFC?: FeatureCollection,
	grassTiles?: GroundTile[]
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

	const stations: GeoStation[] = [];
	for (const [code, s] of Object.entries(manifest.stations)) {
		const p = projection([s.lon, s.lat]);
		if (!p) continue;
		let cx = Math.floor(p[0] / cell) + jitter(code, 'x', 1);
		let cy = Math.floor(p[1] / cell) + jitter(code, 'y', 1);
		cx = Math.max(0, Math.min(cols - 1, cx));
		cy = Math.max(0, Math.min(rows - 1, cy));
		const rpx = Math.max(0, Math.min(worldW, p[0]));
		const rpy = Math.max(0, Math.min(worldH, p[1]));
		stations.push({ code, px: cx * cell + cell / 2, py: cy * cell + cell / 2, rpx, rpy });
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
		const tiles = grassTiles && grassTiles.length ? grassTiles : null;
		// Ground-raster px one tile spans before repeating. The raster is ~cols wide
		// (world / groundScale), so a small value here tiles the grass many times
		// across the landmass instead of stretching it over the whole map.
		const TILE_PX = 10;
		for (let y = 0; y < rows; y++) {
			for (let x = 0; x < cols; x++) {
				const idx = y * cols + x;
				if (!land[idx]) continue;
				const built = urban[idx] === 1;
				const o = idx * 4;
				if (tiles) {
					// Alternate between tiles per tile-block for gentle variation, then
					// scale the sampled pixel so the tile's mean maps onto the theme
					// land/urban fill — texture with the exact current palette + night fade.
					const t = tiles[(Math.floor(x / TILE_PX) + Math.floor(y / TILE_PX)) % tiles.length];
					// Map the TILE_PX-wide footprint back onto the tile's full resolution.
					const sx = Math.floor(((x % TILE_PX) / TILE_PX) * t.w);
					const sy = Math.floor(((y % TILE_PX) / TILE_PX) * t.h);
					const si = (sy * t.w + sx) * 4;
					const tint = built ? uRGB : lRGB;
					img.data[o] = Math.min(255, (t.data[si] * tint[0]) / t.mean[0]);
					img.data[o + 1] = Math.min(255, (t.data[si + 1] * tint[1]) / t.mean[1]);
					img.data[o + 2] = Math.min(255, (t.data[si + 2] * tint[2]) / t.mean[2]);
					img.data[o + 3] = 255;
					continue;
				}
				const useD = coast.has(idx) || (x + y) & 1;
				const base = built ? (useD ? udRGB : uRGB) : useD ? ldRGB : lRGB;
				img.data[o] = base[0];
				img.data[o + 1] = base[1];
				img.data[o + 2] = base[2];
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
		coast,
		stations,
		places,
		project: (lon: number, lat: number) => projection([lon, lat]) ?? null,
		renderGround
	};
}

function hexRGB(hex: string): [number, number, number] {
	const h = hex.replace('#', '');
	return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
