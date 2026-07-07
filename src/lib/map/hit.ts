// Nearest-station hit testing via a quadtree over projected pixel coords.
import { quadtree, type Quadtree } from 'd3-quadtree';

export interface StationPoint {
	code: string;
	x: number; // logical px in the frame
	y: number;
	cellX: number;
	cellY: number;
	/** Stations aggregated into this point's bin (1 at the per-station level). */
	members?: number;
}

export function buildQuadtree(points: StationPoint[]): Quadtree<StationPoint> {
	return quadtree<StationPoint>()
		.x((d) => d.x)
		.y((d) => d.y)
		.addAll(points);
}

/** Nearest station within `radius` logical px, or null. */
export function nearest(
	qt: Quadtree<StationPoint>,
	x: number,
	y: number,
	radius = 24
): StationPoint | null {
	const found = qt.find(x, y, radius);
	return found ?? null;
}
