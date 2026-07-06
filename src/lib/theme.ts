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

export type SkyMode = 'night' | 'dawn' | 'day' | 'dusk';

export interface SkyStop {
	ist: string;
	top: string;
	bottom: string;
	mode: SkyMode;
}

/** Sky ramp keyed by timeIndex 0-7 (00:00..21:00 IST). Rendered as 4 flat bands. */
export const SKY_RAMP: SkyStop[] = [
	{ ist: '00:00', top: '#0B1D3A', bottom: '#142B52', mode: 'night' },
	{ ist: '03:00', top: '#081831', bottom: '#12264A', mode: 'night' },
	{ ist: '06:00', top: '#2E5E9E', bottom: '#F2A65A', mode: 'dawn' },
	{ ist: '09:00', top: '#3D8FD4', bottom: '#6FC4EF', mode: 'day' },
	{ ist: '12:00', top: '#399DE1', bottom: '#5FC2F1', mode: 'day' },
	{ ist: '15:00', top: '#3B95D9', bottom: '#63BEEC', mode: 'day' },
	{ ist: '18:00', top: '#4A5D9E', bottom: '#F08A5D', mode: 'dusk' },
	{ ist: '21:00', top: '#0E2144', bottom: '#1A335C', mode: 'night' }
];

export const NIGHT_STEPS = new Set([0, 1, 7]);
export const HORIZON_STEPS = new Set([2, 6]); // dawn / dusk peach band
export const HORIZON_FRACTION = 0.12; // bottom 12% of frame

/** Quantize the two-stop gradient into N flat bands (banding is the aesthetic). */
export const SKY_BANDS = 4;

// Land fills per sky mode: [fill, dither] drawn in a 2x2 checker.
export const LAND: Record<SkyMode, { fill: string; dither: string }> = {
	day: { fill: '#5B8C6E', dither: '#4A7A5C' },
	dawn: { fill: '#3E6B57', dither: '#335C4A' },
	dusk: { fill: '#3E6B57', dither: '#335C4A' },
	night: { fill: '#16324A', dither: '#122A3E' }
};

export function landForStep(timeIndex: number): { fill: string; dither: string } {
	return LAND[SKY_RAMP[timeIndex].mode];
}

// Cloud colors per band.
export const CLOUD = {
	low: { fill: '#FFFFFF', shadow: '#D8E8F4', alpha: 1 },
	middle: { fill: '#EAF4FF', alpha: 0.92 },
	high: { fill: '#FFFFFF', alpha: 0.65 }
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
