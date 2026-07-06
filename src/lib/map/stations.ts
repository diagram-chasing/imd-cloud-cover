// Project manifest stations to jittered cell positions on the frame.
import type { GeoProjection } from 'd3-geo';
import type { StationsManifest } from '$lib/types';
import { jitter } from './hash';
import type { StationPoint } from './hit';

/**
 * Project each station lon/lat, snap to a cell center, apply deterministic
 * ±1-cell jitter so co-located district points don't stack perfectly.
 */
export function buildStationPoints(
	manifest: StationsManifest,
	projection: GeoProjection,
	cell: number,
	cols: number,
	rows: number
): StationPoint[] {
	const points: StationPoint[] = [];
	for (const [code, s] of Object.entries(manifest.stations)) {
		const projected = projection([s.lon, s.lat]);
		if (!projected) continue;
		const [px, py] = projected;
		let cellX = Math.floor(px / cell) + jitter(code, 'x', 1);
		let cellY = Math.floor(py / cell) + jitter(code, 'y', 1);
		cellX = Math.max(0, Math.min(cols - 1, cellX));
		cellY = Math.max(0, Math.min(rows - 1, cellY));
		points.push({
			code,
			cellX,
			cellY,
			x: cellX * cell + cell / 2,
			y: cellY * cell + cell / 2
		});
	}
	// North-first so southern clouds overdraw northern (depth, A4).
	points.sort((a, b) => a.cellY - b.cellY);
	return points;
}
