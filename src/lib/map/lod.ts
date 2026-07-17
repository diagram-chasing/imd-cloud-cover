// Station LOD binning: coarse grid bins at low zoom, one mark per station at the
// finest level. Pure functions of the geo — no PIXI here.
import { fnv1a, jitter } from './hash';
import { MARK_VARIANTS } from './sprites';
import type { Geo } from './geo';
import type { StationPoint } from './hit';

export interface Bin {
	px: number;
	py: number;
	members: number[];
	code: string;
	variant: number;
}

export interface Lod {
	bin: number;
	scale: number;
	bins: Bin[];
	points: StationPoint[];
}

export const BIN0 = 24;
export const LOD_STEPS: { bin: number | null; enter: number }[] = [
	{ bin: BIN0, enter: 0 },
	{ bin: 16, enter: 1.7 },
	{ bin: 11, enter: 2.9 },
	{ bin: null, enter: 4.6 }
];
export const FINE_LOD = LOD_STEPS.length - 1;
const LOD_DOWN_FACTOR = 0.9;
// Bin-representative tier bias: one tier step ≈ (REP_TIER_BIAS·binSize)² px of
// "effective distance". 0.5 → a megacity (tier 0) reliably outranks a town (tier 3)
// anywhere in the bin, while a one-tier gap still yields to a clearly-centred station.
const REP_TIER_BIAS = 0.5;

function buildBins(geo: Geo, binSize: number | null): Bin[] {
	if (binSize === null) {
		return geo.stations
			.map((st, i) => ({
				px: st.rpx + jitter(st.code, 'jx', 3) + jitter(st.code, 'sx', 2),
				py: st.rpy + jitter(st.code, 'jy', 2) + jitter(st.code, 'sy', 2),
				members: [i],
				code: st.code,
				variant: fnv1a(st.code) % MARK_VARIANTS
			}))
			.sort((a, b) => a.py - b.py);
	}
	const map = new Map<string, Bin>();
	geo.stations.forEach((st, i) => {
		const bx = Math.floor(st.rpx / binSize);
		const by = Math.floor(st.rpy / binSize);
		const key = `${bx},${by}`;
		let b = map.get(key);
		if (!b) {
			b = {
				px: (bx + 0.5) * binSize,
				py: (by + 0.5) * binSize,
				members: [],
				code: st.code,
				variant: 0
			};
			map.set(key, b);
		}
		b.members.push(i);
	});
	// tier penalty in px², scaled by bin size: at coarse LODs (big bins, lots of
	// collisions) a megacity beats a town sitting nearer the centre; at fine LODs
	// the bins are tiny so it fades to plain nearest-to-centre.
	const tierUnit = (REP_TIER_BIAS * binSize) ** 2;
	for (const b of map.values()) {
		let best = Infinity;
		for (const i of b.members) {
			const st = geo.stations[i];
			const d = (st.rpx - b.px) ** 2 + (st.rpy - b.py) ** 2 + st.tier * tierUnit;
			if (d < best) {
				best = d;
				b.code = st.code;
			}
		}
		b.px += jitter(b.code, 'jx', 3);
		b.py += jitter(b.code, 'jy', 2);
		b.variant = fnv1a(b.code) % MARK_VARIANTS;
	}
	return [...map.values()].sort((a, b) => a.py - b.py);
}

export function buildLod(geo: Geo, bin: number | null): Lod {
	const resolved = bin ?? 9;
	const built = buildBins(geo, bin);
	return {
		bin: resolved,
		scale: resolved / BIN0,
		bins: built,
		points: built.map((b) => ({
			code: b.code,
			cellX: 0,
			cellY: 0,
			x: b.px,
			y: b.py,
			members: b.members.length
		}))
	};
}

/** LOD index for zoom ratio r = zoom / containZoom, with hysteresis so a small
 *  zoom-out doesn't immediately drop back to the coarser level. */
export function lodForZoom(r: number, current: number): number {
	let L = 0;
	for (let i = 1; i < LOD_STEPS.length; i++) if (r >= LOD_STEPS[i].enter) L = i;
	if (L < current && r > LOD_STEPS[current].enter * LOD_DOWN_FACTOR) L = current;
	return L;
}
