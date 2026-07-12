// Design tokens for the pixel sky-map. All values are decisions from the spec.
// Colors mirror the meteogram's own cloud panel: chunky white clouds on flat blue.

export const CELL = 8; // logical px per grid cell (desktop).

export type SkyMode = 'day' | 'night';

// Two sky palettes only (day + night). The steps 0-7 are the data axis (00:00..
// 21:00 IST); each maps to day or night. Sun-up (06:00-18:00) is day.
export const NIGHT_STEPS = new Set([0, 1, 7]);

export function skyMode(timeIndex: number): SkyMode {
	return NIGHT_STEPS.has(timeIndex) ? 'night' : 'day';
}

export interface SkyPalette {
	top: string;
	bottom: string;
}

// Day = the meteogram's own blue; night = deep navy for stars.
export const SKY: Record<SkyMode, SkyPalette> = {
	day: { top: '#2E7CC4', bottom: '#6FC4EF' },
	night: { top: '#081831', bottom: '#16335C' }
};

// Ground palette (land, urban, shallow water, coast outline, terrain relief,
// night city lights) lives in scripts/bake-ground.mjs — the ground composite is
// pre-baked into src/lib/assets/ground/*.png and only blitted at runtime.

// Cloud shadows on the ground beneath each station tower.
export const SHADOW_TINT = 0x0a1a28;
export const SHADOW_ALPHA: Record<SkyMode, number> = { day: 0.12, night: 0.08 };

// Sea waves: sparse blinking ticks over open water.
export const WAVE: Record<SkyMode, { color: number; alpha: number }> = {
	day: { color: 0xffffff, alpha: 0.32 },
	night: { color: 0x9fc3e8, alpha: 0.26 }
};

// Cloud colors per band. Tints deepen with altitude so the three layers
// separate when stacked flat: low = solid warm white, middle = clearly cooler
// blue-gray, high = pale ice white. Species read apart by SHAPE + vertical
// position (cirrus = thin streaks up top); the high band stays near-white on
// purpose — a saturated blue streak above the cumulus reads as falling rain.
export const CLOUD = {
	low: { fill: '#FFFFFF', shadow: '#C4D8EC', alpha: 1 },
	middle: { fill: '#B7CFEA', alpha: 0.95 },
	high: { fill: '#E6F2FB', alpha: 0.55 }
} as const;

export type BandKey = 'high' | 'middle' | 'low';

// UI palette.
export const UI = {
	inkOnLight: '#0B1D3A',
	inkOnDark: '#FFFFFF',
	accent: '#399DE1',
	paper: '#FDFBF4',
	focus: '#F2A65A',
	sunGold: '#F2C14E',
	cloudBlock: '#D8E8F4'
} as const;

// Below this a station reads as clear — kills the sub-scale wisps that made
// clear and lightly-clouded land look identical when all bands are on.
const COVER_FLOOR = 20;
// Perceptual shaping of the visible range [FLOOR..100]. >1 reserves the top
// tiers for genuinely heavy cover, so marks stay small/faint until cover is
// real, then jump — dense regions visibly pop, sparse ones recede.
const COVER_GAMMA = 1.3;

/** Cover % -> sprite tier (1-4). Cover < COVER_FLOOR -> 0 (no sprite). */
export function coverTier(cover: number): 0 | 1 | 2 | 3 | 4 {
	if (cover < COVER_FLOOR) return 0;
	const t = (cover - COVER_FLOOR) / (100 - COVER_FLOOR); // 0..1 in visible range
	const tier = Math.ceil(Math.pow(t, COVER_GAMMA) * 4);
	return Math.min(4, Math.max(1, tier)) as 1 | 2 | 3 | 4;
}

// Effective-cover threshold shared with the pipeline.
export const CLEAR_STARS = 25; // stars appear where max(h,m,l) < this
