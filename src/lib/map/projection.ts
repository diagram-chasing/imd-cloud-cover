// Expand India topojson into a GeoJSON FeatureCollection for the pixel map.
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { FeatureCollection } from 'geojson';

/** Expand a topojson's first object into a GeoJSON FeatureCollection. */
export function topoToFeatures(topo: Topology): FeatureCollection {
	const objName = Object.keys(topo.objects)[0];
	return feature(topo, topo.objects[objName] as GeometryCollection) as FeatureCollection;
}

/** Merge all state features into one GeoJSON FeatureCollection. */
export const topoToIndia = topoToFeatures;
