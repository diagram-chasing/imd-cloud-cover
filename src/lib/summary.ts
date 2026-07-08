// Plain-language sky read, aligned to NOAA/NWS public forecast wording so the
// tooltip and station card speak the language readers already know.

/** Bands weighted by opacity before we pick a category. NOAA's sky-condition
 *  percentages count only *opaque* cloud — thin high cirrus is excluded — so we
 *  discount higher bands. Weights mirror the map's ground-shadow model
 *  (PixelMap.updateClouds) so the summary and the shadows tell one story. */
export function effectiveCover(v: { h: number; m: number; l: number }): number {
	return Math.max(v.l, v.m * 0.8, v.h * 0.45);
}

/** NWS public sky-condition ladder, keyed to opaque cloud cover (0-100).
 *  Boundaries are the standard eighths: 1/8, 3/8, 5/8, 7/8. */
export function skyCondition(v: { h: number; m: number; l: number } | null): string {
	if (!v) return '';
	const c = effectiveCover(v);
	if (c < 13) return 'CLEAR';
	if (c < 38) return 'MOSTLY CLEAR';
	if (c < 63) return 'PARTLY CLOUDY';
	if (c < 88) return 'MOSTLY CLOUDY';
	return 'OVERCAST';
}
