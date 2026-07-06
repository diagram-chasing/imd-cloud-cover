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
export const LAND: Record<SkyMode, { fill: string; dither: string }> = {
	day: { fill: '#5B8C6E', dither: '#4A7A5C' },
	night: { fill: '#16324A', dither: '#122A3E' }
};

export function landForStep(timeIndex: number): { fill: string; dither: string } {
	return LAND[skyMode(timeIndex)];
}

// Cloud colors per band. Tints deepen with altitude so the three layers
// separate when stacked flat: low = solid white, middle = blue-gray,
// high = translucent ice blue.
export const CLOUD = {
	low: { fill: '#FFFFFF', shadow: '#D8E8F4', alpha: 1 },
	middle: { fill: '#D9E8F6', alpha: 0.95 },
	high: { fill: '#CDE6FF', alpha: 0.55 }
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

/** Cover % -> sprite tier (1-4). Cover < 1 -> 0 (no sprite). */
export function coverTier(cover: number): 0 | 1 | 2 | 3 | 4 {
	if (cover < 1) return 0;
	if (cover <= 25) return 1;
	if (cover <= 50) return 2;
	if (cover <= 75) return 3;
	return 4;
}

// Effective-cover thresholds shared with the pipeline.
export const CLOUDY_DAY = 60; // persistence column / fog belt
export const CLEAR_STARS = 25; // stars appear where max(h,m,l) < this
