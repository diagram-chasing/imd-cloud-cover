export const CELL = 8;

export type SkyMode = 'day' | 'night';
// twilight is a sky-only overlay (dawn/dusk); ground textures stay 2-state via skyMode
export type SkyPhase = SkyMode | 'twilight';

// day = steps 2-6 (06:00-18:00 IST); steps 0, 1, 7 are night
export const NIGHT_STEPS = new Set([0, 1, 7]);
// dawn (06:00) and dusk (18:00) get the intermediate twilight sky
export const TWILIGHT_STEPS = new Set([2, 6]);

export function skyMode(timeIndex: number): SkyMode {
	return NIGHT_STEPS.has(timeIndex) ? 'night' : 'day';
}

export function skyPhase(timeIndex: number): SkyPhase {
	if (NIGHT_STEPS.has(timeIndex)) return 'night';
	if (TWILIGHT_STEPS.has(timeIndex)) return 'twilight';
	return 'day';
}

export interface SkyPalette {
	top: string;
	bottom: string;
}

// flat fill (only `top` is drawn); twilight is a warm dusk block between day and night
export const SKY: Record<SkyPhase, SkyPalette> = {
	day: { top: '#3A88CC', bottom: '#6FC4EF' },
	twilight: { top: '#2A5687', bottom: '#2A5687' },
	night: { top: '#081831', bottom: '#16335C' }
};

// ground palette lives in bake-ground.mjs; composite is pre-baked into ground/*.png

export const SHADOW_TINT = 0x0a1a28;
export const SHADOW_ALPHA: Record<SkyMode, number> = { day: 0.12, night: 0.08 };

export const WAVE: Record<SkyMode, { color: number; alpha: number }> = {
	day: { color: 0xffffff, alpha: 0.32 },
	night: { color: 0x9fc3e8, alpha: 0.26 }
};

// tints deepen with altitude; high stays near-white - a saturated blue reads as rain
export const CLOUD = {
	low: { fill: '#FFFFFF', shadow: '#C4D8EC', alpha: 1 },
	middle: { fill: '#B7CFEA', alpha: 0.95 },
	high: { fill: '#E6F2FB', alpha: 0.55 }
} as const;

// Streaks are baked white and tinted per sky mode at runtime (CloudField.setRainMode)
// so they read as a soft blue over the bright day ground and dim down at night
// rather than glowing against the darkened land.
// Keyed by sky PHASE, not mode: full day needs a deeper blue to carry contrast
// against the bright green ground, while the dimmer twilight scene reads well
// with the same lighter blue as night.
export const RAIN: Record<SkyPhase, { tint: number; alpha: number }> = {
	day: { tint: 0x2e7cc4, alpha: 0.92 }, // --day-sea: the map's own daytime water
	twilight: { tint: 0x74acdf, alpha: 0.9 }, // lighter blue pops on the warm-tinted dusk ground
	night: { tint: 0x74acdf, alpha: 0.85 }
};

// mm per 3-hour step; IMD-style light / moderate / heavy bins
const RAIN_TIERS = [1, 5, 15];

/** Rain (mm/3h) -> intensity tier. 0 = dry (no sprite, no label override). */
export function rainTier(mm3h: number | undefined): 0 | 1 | 2 | 3 {
	if (!mm3h || mm3h < RAIN_TIERS[0]) return 0;
	if (mm3h < RAIN_TIERS[1]) return 1;
	if (mm3h < RAIN_TIERS[2]) return 2;
	return 3;
}

export type BandKey = 'high' | 'middle' | 'low';

export const UI = {
	inkOnLight: '#0B1D3A',
	inkOnDark: '#FFFFFF',
	accent: '#399DE1',
	paper: '#FDFBF4',
	focus: '#F2A65A',
	sunGold: '#F2C14E',
	cloudBlock: '#D8E8F4'
} as const;

// below this reads as clear; kills sub-scale wisps on lightly-clouded land
const COVER_FLOOR = 20;
// gamma > 1: marks stay faint until cover is real, then pop
const COVER_GAMMA = 1.3;

/** Cover % -> sprite tier (1-4). Cover < COVER_FLOOR -> 0 (no sprite). */
export function coverTier(cover: number): 0 | 1 | 2 | 3 | 4 {
	if (cover < COVER_FLOOR) return 0;
	const t = (cover - COVER_FLOOR) / (100 - COVER_FLOOR); // 0..1 in visible range
	const tier = Math.ceil(Math.pow(t, COVER_GAMMA) * 4);
	return Math.min(4, Math.max(1, tier)) as 1 | 2 | 3 | 4;
}

export const CLEAR_STARS = 25; // shared with pipeline; stars where max(h,m,l) < this
