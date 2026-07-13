// mirrors build-places.mjs copy - standalone so the app never imports a build script
export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
	const R = 6371;
	const dLat = ((bLat - aLat) * Math.PI) / 180;
	const dLon = ((bLon - aLon) * Math.PI) / 180;
	const la1 = (aLat * Math.PI) / 180;
	const la2 = (bLat * Math.PI) / 180;
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
	return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
