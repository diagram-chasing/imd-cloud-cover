// The home map's cloud marks (high cirrus → mid alto → low cumulus, coloured and
// sized by cover) assembled into a vertical "tower" of SVG cells. Shared by the
// city locator map and the nearby-stations list so a station reads the same
// wherever it appears. Pure — no DOM — returns cell coordinates to plot.
import { makePattern, MARK_ALPHA, TIER_ALPHA, MARK_VARIANTS } from '$lib/map/sprites';
import { CLOUD, coverTier, type BandKey } from '$lib/theme';
import { fnv1a } from '$lib/map/hash';

export interface CloudCell {
	x: number;
	y: number;
	fill: string;
	opacity: number;
}
export interface CloudTower {
	cells: CloudCell[];
	/** Tower footprint in sprite cells. */
	w: number;
	h: number;
}

const BANDS: { band: BandKey; key: 'h' | 'm' | 'l' }[] = [
	{ band: 'high', key: 'h' },
	{ band: 'middle', key: 'm' },
	{ band: 'low', key: 'l' }
];

/** Build a station's cloud tower from its {h,m,l} cover. Empty tower = clear sky. */
export function buildTower(
	code: string,
	v?: { h: number; m: number; l: number } | null
): CloudTower {
	const variant = fnv1a(code) % MARK_VARIANTS;
	const layers: { rows: number[][]; cols: number; fill: string; opacity: number }[] = [];
	if (v) {
		for (const { band, key } of BANDS) {
			const tier = coverTier(v[key]);
			if (tier === 0) continue;
			const rows = makePattern(band, tier, variant);
			layers.push({
				rows,
				cols: Math.max(...rows.map((r) => r.length)),
				fill: CLOUD[band].fill,
				opacity: MARK_ALPHA[band] * TIER_ALPHA[tier - 1]
			});
		}
	}
	const w = layers.length ? Math.max(...layers.map((l) => l.cols)) : 0;
	const cells: CloudCell[] = [];
	let y0 = 0;
	for (const layer of layers) {
		const xoff = Math.floor((w - layer.cols) / 2);
		for (let ry = 0; ry < layer.rows.length; ry++) {
			for (let cx = 0; cx < layer.rows[ry].length; cx++) {
				if (layer.rows[ry][cx]) {
					cells.push({ x: xoff + cx, y: y0 + ry, fill: layer.fill, opacity: layer.opacity });
				}
			}
		}
		y0 += layer.rows.length;
	}
	return { cells, w, h: y0 };
}
