// Geographic geometry for the Pixi map: project India and list station/place
// positions in projected (px, py) space. The oblique "from the side" tilt +
// cloud altitudes are applied in the Pixi layer.
//
// The ground itself (land + relief + coast + shallow ring + urban + night
// lights) is pre-baked by scripts/bake-ground.mjs into day/night PNGs plus a
// mask; at runtime we only decode the mask for the land/shallow grids (waves
// live over open sea) and blit the baked images.
import { geoConicConformal, type GeoProjection } from 'd3-geo';
import type { FeatureCollection, Feature, Geometry } from 'geojson';
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
	/** Population bucket from the baker: 0 megacity … 3 town. Drives label LOD. */
	tier: number;
	state: string | null;
	/** Nearest IMD station code + rounded distance (km), precomputed at build. */
	nearest: string | null;
	nkm: number;
	px: number; // projected world px (unsquashed)
	py: number;
}

/** Decoded ground-mask.png: R = land, G = shallow near-coast ring. */
export interface GroundMask {
	cols: number;
	rows: number;
	land: Uint8Array;
	shallow: Uint8Array;
}

export interface Geo {
	cell: number;
	/** World px per ground raster pixel — the sprite scale for the baked ground. */
	groundScale: number;
	cols: number;
	rows: number;
	worldW: number;
	worldH: number; // natural (unsquashed) projected height
	land: Uint8Array;
	/** Sea cells in the lighter near-coast ring. */
	shallow: Uint8Array;
	stations: GeoStation[];
	places: GeoPlace[];
	/** Project a lon/lat into world px with the map's projection (may be off-map). */
	project(lon: number, lat: number): [number, number] | null;
}

function loadImage(url: string): Promise<HTMLImageElement> {
	return new Promise((res, rej) => {
		const im = new Image();
		im.onload = () => res(im);
		im.onerror = rej;
		im.src = url;
	});
}

export async function loadGroundMask(url: string): Promise<GroundMask> {
	const img = await loadImage(url);
	const cols = img.naturalWidth;
	const rows = img.naturalHeight;
	const c = document.createElement('canvas');
	c.width = cols;
	c.height = rows;
	const ctx = c.getContext('2d', { willReadFrequently: true })!;
	ctx.drawImage(img, 0, 0);
	const px = ctx.getImageData(0, 0, cols, rows).data;
	const land = new Uint8Array(cols * rows);
	const shallow = new Uint8Array(cols * rows);
	for (let i = 0; i < cols * rows; i++) {
		if (px[i * 4] > 127) land[i] = 1;
		if (px[i * 4 + 1] > 127) shallow[i] = 1;
	}
	return { cols, rows, land, shallow };
}

export function buildGeo(
	india: FeatureCollection,
	manifest: StationsManifest,
	worldW: number,
	cell: number,
	placesFC?: FeatureCollection,
	mask?: GroundMask
): Geo {
	const worldH = worldW * 1.06;
	// Must mirror scripts/bake-ground.mjs: the baked ground raster is DETAIL
	// sub-cells per cloud cell.
	const DETAIL = 2;
	const gcell = cell / DETAIL;
	const cols = mask?.cols ?? Math.floor(worldW / gcell);
	const rows = mask?.rows ?? Math.floor(worldH / gcell);

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
				tier: Number(f.properties?.tier ?? 3),
				state: (f.properties?.state as string | null) ?? null,
				nearest: (f.properties?.nearest as string | null) ?? null,
				nkm: Number(f.properties?.nkm ?? 0),
				px: p[0],
				py: p[1]
			});
		}
	}

	return {
		cell,
		groundScale: gcell,
		cols,
		rows,
		worldW,
		worldH,
		land: mask?.land ?? new Uint8Array(cols * rows),
		shallow: mask?.shallow ?? new Uint8Array(cols * rows),
		stations,
		places,
		project: (lon: number, lat: number) => projection([lon, lat]) ?? null
	};
}
