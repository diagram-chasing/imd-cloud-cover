// Layout math for the SkyWindow explainer: a seeded, per-band ordering of every
// block in the sky grid so that N% cover = the first round(N% × total) blocks.
// A prefix of a fixed list makes slider motion monotone (clouds only accrete,
// never reshuffle), deterministic across visits, and exact to ±1 block.

import type { BandKey } from '$lib/theme';
import { makePattern, MARK_VARIANTS } from '$lib/map/sprites';
import { fnv1a, mulberry32 } from '$lib/map/hash';

export interface LayerOrder {
	/** Block column per rank; drawing ranks [0, n) yields exactly n/total cover. */
	x: Uint16Array;
	y: Uint16Array;
	total: number;
}

// Anchor grid per band: sprite puffs are seeded one-per-anchor-cell, so they
// cannot overlap horizontally and the slot phase spreads across the window.
const ANCHORS: Record<BandKey, [number, number]> = {
	low: [5, 3],
	middle: [5, 5],
	high: [4, 6]
};
// Vertical range each band's puffs seed into (fraction of the sky rect) — a
// depth cue: cirrus hangs high in the frame, cumulus sits lower. Accretion
// still reaches every block, so 100% always closes into a full sheet.
const VRANGE: Record<BandKey, [number, number]> = {
	high: [0.02, 0.55],
	middle: [0.15, 0.75],
	low: [0.32, 0.92]
};
// Sprite tier per slot, cycled in shuffled-visit order: mixes sizes so a
// half-covered sky reads as an assortment of clouds, not a uniform stamp.
const TIER_CYCLE: Record<BandKey, number[]> = {
	low: [3, 2, 4, 2, 3, 1, 4, 2],
	middle: [3, 2, 4, 3, 2, 4, 1, 3],
	high: [4, 3, 2, 4, 3, 2, 4, 3]
};
// Anisotropic growth: accreted blocks cost more vertically than horizontally,
// so low clouds swell into round blobs while cirrus stretches into streaks.
const WV: Record<BandKey, number> = { low: 1, middle: 2, high: 4 };

export function buildLayerOrder(band: BandKey, cols: number, rows: number): LayerOrder {
	const total = cols * rows;
	const x = new Uint16Array(total);
	const y = new Uint16Array(total);
	const occ = new Uint8Array(total);
	let n = 0;
	const rand = mulberry32(fnv1a('skywin:' + band));
	const push = (bx: number, by: number) => {
		if (bx < 0 || by < 0 || bx >= cols || by >= rows) return;
		const i = by * cols + bx;
		if (occ[i]) return;
		occ[i] = 1;
		x[n] = bx;
		y[n] = by;
		n++;
	};

	// Slot phase: whole sprite puffs first, in a shuffled anchor order, so low
	// percentages read as individual clouds rather than scattered blocks.
	const [aCols, aRows] = ANCHORS[band];
	const [v0, v1] = VRANGE[band];
	const slots = Array.from({ length: aCols * aRows }, (_, i) => i);
	for (let i = slots.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[slots[i], slots[j]] = [slots[j], slots[i]];
	}
	const cycle = TIER_CYCLE[band];
	const anchorW = cols / aCols;
	slots.forEach((slot, k) => {
		const ac = slot % aCols;
		const ar = Math.floor(slot / aCols);
		let tier = cycle[k % cycle.length];
		let pat = makePattern(band, tier, k % MARK_VARIANTS);
		let pw = Math.max(...pat.map((r) => r.length));
		// narrow windows get narrow anchor lanes: shrink the sprite until it fits
		while (tier > 1 && pw > anchorW - 1) {
			tier--;
			pat = makePattern(band, tier, k % MARK_VARIANTS);
			pw = Math.max(...pat.map((r) => r.length));
		}
		const ph = pat.length;
		const x0 = Math.round(ac * anchorW + rand() * Math.max(1, anchorW - pw));
		const vy = v0 + ((v1 - v0) * (ar + rand() * 0.8)) / aRows;
		const y0 = Math.round(vy * Math.max(0, rows - ph));
		for (let py = 0; py < ph; py++) {
			for (let px = 0; px < pat[py].length; px++) {
				if (pat[py][px]) push(x0 + px, y0 + py);
			}
		}
	});
	if (n === 0) push(Math.floor(cols / 2), Math.floor(rows / 2));

	// Accretion phase: the remaining blocks, nearest-to-a-puff first, so rising
	// cover swells and merges the existing clouds until the sheet closes.
	const seeds = n;
	const w = WV[band];
	const free: { i: number; d: number }[] = [];
	for (let by = 0; by < rows; by++) {
		for (let bx = 0; bx < cols; bx++) {
			const i = by * cols + bx;
			if (occ[i]) continue;
			let d = Infinity;
			for (let s = 0; s < seeds; s++) {
				const dd = Math.abs(bx - x[s]) + w * Math.abs(by - y[s]);
				if (dd < d) d = dd;
			}
			free.push({ i, d: d + rand() * 0.75 });
		}
	}
	free.sort((a, b) => a.d - b.d);
	for (const f of free) {
		occ[f.i] = 1;
		x[n] = f.i % cols;
		y[n] = Math.floor(f.i / cols);
		n++;
	}
	return { x, y, total };
}

export interface GroundProfile {
	/** Extra rooftop blocks above the base strip, per column. */
	rise: number[];
	/** Columns that carry a thin antenna one block above the roof. */
	antenna: boolean[];
}

/** Seeded rooftop silhouette: runs of 2–5 columns at a shared height. */
export function groundProfile(cols: number): GroundProfile {
	const rand = mulberry32(fnv1a('skywin:ground'));
	const rise: number[] = new Array(cols).fill(0);
	const antenna: boolean[] = new Array(cols).fill(false);
	let c = 0;
	while (c < cols) {
		const w = 2 + Math.floor(rand() * 4);
		const h = Math.floor(rand() * 3);
		for (let i = 0; i < w && c + i < cols; i++) rise[c + i] = h;
		if (h > 0 && rand() < 0.22) antenna[Math.min(cols - 1, c + Math.floor(w / 2))] = true;
		c += w;
	}
	return { rise, antenna };
}

/** #RRGGBB linear interpolation for the canvas sky bands. */
export function lerpHex(a: string, b: string, t: number): string {
	const pa = parseInt(a.slice(1), 16);
	const pb = parseInt(b.slice(1), 16);
	const ch = (sh: number) => {
		const va = (pa >> sh) & 255;
		return Math.round(va + (((pb >> sh) & 255) - va) * t);
	};
	return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
}
