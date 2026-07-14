// Place = station. The map label layer and the city pages used to be driven by a
// separate GeoNames gazetteer (india-places.json) joined to the nearest station,
// which produced spurious far matches. Now each IMD station *is* a place: its name,
// district and state are IMD's own, and the "population" is its district headline.
// This derives the FeatureCollection those consumers expect straight from the
// manifest, so `nearest` is the station's own code and `nkm` is 0.
import type { FeatureCollection } from 'geojson';
import type { StationsManifest } from '$lib/types';

/** Build the place-label / search FeatureCollection from the station manifest. */
export function placesFromManifest(manifest: StationsManifest): FeatureCollection {
	return {
		type: 'FeatureCollection',
		features: Object.entries(manifest.stations).map(([code, s]) => ({
			type: 'Feature',
			properties: {
				name: s.name,
				pop: s.pop ?? 0,
				state: s.state,
				district: s.district ?? null,
				tier: s.tier ?? 3,
				nearest: code,
				nkm: 0,
				aliases: s.aliases ?? []
			},
			geometry: { type: 'Point', coordinates: [s.lon, s.lat] }
		}))
	};
}
