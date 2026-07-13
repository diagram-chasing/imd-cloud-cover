// project India and list stations in world px. ground is pre-baked; only the mask is decoded at runtime
import { geoConicConformal, type GeoProjection } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { FeatureCollection, Feature, Geometry } from 'geojson';
import { jitter } from './hash';
import type { StationsManifest } from '$lib/types';

/** Expand a topojson's first object (India's states) into a GeoJSON FeatureCollection. */
export function topoToFeatures(topo: Topology): FeatureCollection {
	const objName = Object.keys(topo.objects)[0];
	return feature(topo, topo.objects[objName] as GeometryCollection) as FeatureCollection;
}

export interface GeoStation {
	code: string;
	px: number; // projected world px (unsquashed), snapped to the CELL grid
	py: number;
	rpx: number; // unsnapped - LOD binning uses these, not the legacy CELL snap
	rpy: number;
}

export interface GeoPlace {
	name: string;
	pop: number;
	/** Population bucket: 0 megacity .. 3 town. Drives label LOD. */
	tier: number;
	state: string | null;
	/** Nearest IMD station code + distance (km), precomputed at build. */
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
	/** World px per ground raster pixel. */
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
	/** Project lon/lat into world px (may be off-map). */
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

/** Project a place FeatureCollection into world-px labels. Reused when `places`
 *  arrives after the initial geo build (deferred load). */
export function buildPlaces(
	placesFC: FeatureCollection,
	project: (lon: number, lat: number) => [number, number] | null
): GeoPlace[] {
	const places: GeoPlace[] = [];
	for (const f of placesFC.features) {
		if (f.geometry?.type !== 'Point') continue;
		const [lon, lat] = f.geometry.coordinates as [number, number];
		const p = project(lon, lat);
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
	return places;
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
	// must mirror bake-ground.mjs: DETAIL sub-cells per cloud cell
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

	const places = placesFC ? buildPlaces(placesFC, (lon, lat) => projection([lon, lat]) ?? null) : [];

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
