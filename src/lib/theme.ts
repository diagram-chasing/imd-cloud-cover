// Design tokens for the pixel sky-map. All values are decisions from the spec.
// Colors mirror the meteogram's own cloud panel: chunky white clouds on flat blue.

export const CELL = 8; // logical px per grid cell (desktop). See cellForWidth().
export const FRAME_W = 900; // logical px, desktop map frame width
// Frame height derived from India's aspect (~1.06) rounded to whole cells.
export const FRAME_H = Math.round((FRAME_W * 1.06) / CELL) * CELL;

/** Responsive cell size: 8 desktop, 6 tablet (<1024), 5 mobile (<640). */
export function cellForWidth(viewportWidth: number): number {
	if (viewportWidth < 640) return 5;
	if (viewportWidth < 1024) return 6;
	return 8;
}

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

export function skyFor(timeIndex: number): SkyPalette {
	return SKY[skyMode(timeIndex)];
}

/** Quantize the sky gradient into N flat bands (banding is the aesthetic). */
export const SKY_BANDS = 5;

// Land fills per sky mode: [fill, dither] drawn in a 2x2 checker.
// India stays green day and night (only the sky changes); night uses a slightly
// deeper green so it settles against the navy sky without going blue.
export const LAND: Record<SkyMode, { fill: string; dither: string }> = {
	day: { fill: '#5B8C6E', dither: '#568768' },
	night: { fill: '#3E6B54', dither: '#3A664F' }
};

export function landForStep(timeIndex: number): { fill: string; dither: string } {
	return LAND[skyMode(timeIndex)];
}

// Built-up (urban) patches sit on top of the land raster in the same 2x2 checker.
// A lighter, more yellow-green than the countryside reads as developed land while
// staying in the green family (not concrete/brown); night deepens to settle under
// the navy.
export const URBAN: Record<SkyMode, { fill: string; dither: string }> = {
	day: { fill: '#7D9660', dither: '#728A57' },
	night: { fill: '#496142', dither: '#405639' }
};

export function urbanForStep(timeIndex: number): { fill: string; dither: string } {
	return URBAN[skyMode(timeIndex)];
}

// Major rivers: a muted, desaturated blue drawn one sub-cell wide over the land.
// Pulled toward the green land so it reads as a subtle waterway, not a bright
// stroke; night deepens to sit under the navy sky.
export const RIVER: Record<SkyMode, string> = {
	day: '#8DB0C7',
	night: '#52708A'
};

export function riverForStep(timeIndex: number): string {
	return RIVER[skyMode(timeIndex)];
}

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
	cloudBlock: '#D8E8F4',
	persistence: 'rgba(11, 29, 58, 0.55)'
} as const;

// Below this a station reads as clear — kills the sub-scale wisps that made
// clear and lightly-clouded land look identical when all bands are on.
export const COVER_FLOOR = 20;
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

// Effective-cover thresholds shared with the pipeline.
export const CLOUDY_DAY = 60; // persistence column / fog belt
export const CLEAR_STARS = 25; // stars appear where max(h,m,l) < this
