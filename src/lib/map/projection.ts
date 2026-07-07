// D3 projection for India, fit to the pixel frame with a 2-cell margin.
import { geoConicConformal, type GeoProjection } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { FeatureCollection, Feature, Geometry } from 'geojson';

export interface ProjectionResult {
	projection: GeoProjection;
	india: FeatureCollection;
	frameW: number;
	frameH: number;
}

/** Expand a topojson's first object into a GeoJSON FeatureCollection. */
export function topoToFeatures(topo: Topology): FeatureCollection {
	const objName = Object.keys(topo.objects)[0];
	return feature(topo, topo.objects[objName] as GeometryCollection) as FeatureCollection;
}

/** Merge all state features into one GeoJSON FeatureCollection. */
export const topoToIndia = topoToFeatures;

/**
 * Build a conic-conformal projection fit to [margin, frame - margin].
 * parallels/rotate chosen for India (spec A3).
 */
export function buildProjection(
	india: FeatureCollection,
	frameW: number,
	frameH: number,
	cell: number
): GeoProjection {
	const margin = cell * 2;
	return geoConicConformal()
		.parallels([12, 36])
		.rotate([-82.5, 0])
		.fitExtent(
			[
				[margin, margin],
				[frameW - margin, frameH - margin]
			],
			india as unknown as Feature<Geometry>
		);
}
