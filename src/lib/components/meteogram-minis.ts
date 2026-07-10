// Simplified redraws of the eight IMD meteogram panels, built with d3 from
// generated (deterministic) sample data. Each mini reproduces its panel's
// visual grammar — series, markers, bands, barbs, whiskers, gridlines — in the
// plate's own palette, at readable line weights.
import { scaleLinear } from 'd3';
import { line, area, curveMonotoneX, curveBasis } from 'd3';

export const VB = { w: 120, h: 40 };
// Panels that need more vertical room than the default strip.
export const MINI_H: Record<string, number> = { 'upper-air': 64 };

export type El =
	| {
			t: 'path';
			d: string;
			stroke?: string;
			fill?: string;
			sw?: number;
			dash?: string;
			o?: number;
			clip?: boolean;
	  }
	| { t: 'rect'; x: number; y: number; w: number; h: number; fill: string; o?: number; clip?: boolean }
	| { t: 'circle'; cx: number; cy: number; r: number; fill: string; stroke?: string; sw?: number };

const N = 80; // 3-hourly samples over 10 days
const X = scaleLinear([0, N - 1], [1, 119]);
const xi = (i: number) => X(i);

// Deterministic value noise — keeps SSR and client markup identical.
const noise = (i: number, s: number) =>
	0.5 * Math.sin(i * 0.61 + s * 1.7) +
	0.35 * Math.sin(i * 0.23 + s * 4.1) +
	0.15 * Math.sin(i * 1.51 + s * 7.3);
const hourOf = (i: number) => (i % 8) * 3;
// Daytime bell: 0 overnight, peaks ~14:00 IST
const daybell = (i: number) => Math.exp(-((hourOf(i) - 14) ** 2) / 16);
const dayOf = (i: number) => Math.floor(i / 8);

function seriesPath(ys: number[], smooth = false): string {
	const gen = line<number>()
		.x((_, i) => xi(i))
		.y((d) => d);
	if (smooth) gen.curve(curveMonotoneX);
	return gen(ys) ?? '';
}

// Shared frame: dashed day boundaries + dotted value gridlines, like the plate.
function grid(hLines: number[] = [13.3, 26.7]): El[] {
	const els: El[] = [];
	for (let d = 1; d < 10; d++) {
		els.push({
			t: 'path',
			d: `M ${(d * 120) / 10} 0 V 40`,
			stroke: '#c3c9d4',
			sw: 0.4,
			dash: '1.6 2'
		});
	}
	for (const y of hLines) {
		els.push({ t: 'path', d: `M 0 ${y} H 120`, stroke: '#c3c9d4', sw: 0.4, dash: '0.8 1.6' });
	}
	return els;
}

// Wind barb glyph: slanted staff with two ticks, like the plate's barbs.
function barb(x: number, y: number): string {
	return `M ${x} ${y} l 6 -3 m -1 0.5 l 1.6 1.7 m -3.2 -0.9 l 1.6 1.7`;
}
function barbRow(y: number, step = 6, jitterSeed = 0): El {
	let d = '';
	for (let x = 2; x < 116; x += step) {
		d += barb(x, y + 1.4 * noise(x, jitterSeed)) + ' ';
	}
	return { t: 'path', d, stroke: '#77786b', sw: 0.55 };
}

/* ---- 1 · UPPER AIR: shaded RH/cloud field, barb rows, contour lines ----
   Drawn taller (120×64) — it is by far the deepest panel on the plate. */
function upperAir(): El[] {
	const H = MINI_H['upper-air'];
	const els: El[] = [];
	for (let d = 1; d < 10; d++) {
		els.push({
			t: 'path',
			d: `M ${(d * 120) / 10} 0 V ${H}`,
			stroke: '#c3c9d4',
			sw: 0.4,
			dash: '1.6 2'
		});
	}
	for (const y of [H / 3, (2 * H) / 3]) {
		els.push({ t: 'path', d: `M 0 ${y} H 120`, stroke: '#c3c9d4', sw: 0.4, dash: '0.8 1.6' });
	}
	const wavy = (base: number, amp: number, seed: number) =>
		Array.from({ length: 25 }, (_, k) => base + amp * noise(k, seed));
	const band = area<number>()
		.x((_, k) => (k * 120) / 24)
		.y0((d) => d)
		.curve(curveBasis);
	// gray cloud shading, two loose layers
	els.push({
		t: 'path',
		d: band.y1((d, k) => d + 11 + 5 * noise(k, 9))(wavy(5, 4, 2)) ?? '',
		fill: '#dde2dd',
		o: 0.9
	});
	els.push({
		t: 'path',
		d: band.y1((d, k) => d + 13 + 6 * noise(k, 12))(wavy(36, 5, 5)) ?? '',
		fill: '#e3e7e3',
		o: 0.9
	});
	// green humidity shading, medium + bright patches
	const patch = (
		x0: number,
		x1: number,
		base: number,
		amp: number,
		th: number,
		seed: number,
		fill: string,
		o: number
	): El => {
		const pts = Array.from({ length: 16 }, (_, k) => {
			const x = x0 + ((x1 - x0) * k) / 15;
			return [x, base + amp * noise(k, seed)] as [number, number];
		});
		const a = area<[number, number]>()
			.x((p) => p[0])
			.y0((p, k) => p[1] + th + 4 * noise(k, seed * 3))
			.y1((p) => p[1])
			.curve(curveBasis);
		return { t: 'path', d: a(pts) ?? '', fill, o };
	};
	els.push(patch(4, 58, 38, 5, 18, 21, '#8fdc8f', 0.95));
	els.push(patch(40, 96, 10, 4, 13, 27, '#8fdc8f', 0.95));
	els.push(patch(10, 40, 45, 3, 13, 33, '#27cf27', 0.9));
	els.push(patch(66, 118, 42, 5, 16, 39, '#27cf27', 0.9));
	els.push(patch(78, 108, 13, 3, 10, 45, '#27cf27', 0.85));
	// freezing level: thin black double line
	const frz = Array.from({ length: N }, (_, i) => 21 + 2.6 * noise(i, 16));
	els.push({ t: 'path', d: seriesPath(frz, true), stroke: '#3a3a3a', sw: 0.5 });
	els.push({ t: 'path', d: seriesPath(frz.map((y) => y + 1.2), true), stroke: '#3a3a3a', sw: 0.5 });
	// temperature contours: purple aloft, cyan mid-levels
	els.push({
		t: 'path',
		d: seriesPath(Array.from({ length: N }, (_, i) => 9 + 3 * noise(i, 18)), true),
		stroke: '#9a55d6',
		sw: 0.9
	});
	els.push({
		t: 'path',
		d: seriesPath(Array.from({ length: N }, (_, i) => 38 + 3.5 * noise(i, 23)), true),
		stroke: '#43b8cc',
		sw: 0.9
	});
	// three rows of wind barbs
	els.push(barbRow(12, 6, 1), barbRow(32, 6, 2), barbRow(53, 6, 3));
	return els;
}

/* ---- 2 · PRESSURE: jagged SLP line + thickness line with triangles ---- */
function pressure(): El[] {
	const els: El[] = [...grid()];
	// SLP: semidiurnal tide + slow drift
	const slp = Array.from(
		{ length: N },
		(_, i) => 21 + 5.5 * Math.sin((hourOf(i) / 12) * Math.PI * 2 + 0.8) * (0.7 + 0.3 * noise(i, 3)) + 3.5 * noise(i, 7)
	);
	const thk = Array.from({ length: N }, (_, i) => 16 + 6 * noise(i, 11) + 2.5 * Math.sin(i * 0.35));
	els.push({ t: 'path', d: seriesPath(thk), stroke: '#3aacb4', sw: 0.9 });
	let tri = '';
	for (let i = 0; i < N; i += 2) {
		tri += `M ${xi(i)} ${thk[i] - 1.1} l 1.1 1.9 h -2.2 Z `;
	}
	els.push({ t: 'path', d: tri, stroke: '#3aacb4', sw: 0.5, fill: '#ffffff' });
	els.push({ t: 'path', d: seriesPath(slp), stroke: '#2444c4', sw: 1.2 });
	return els;
}

/* ---- 3 · INSTABILITY: CAPE bars + lifted-index line with diamonds ---- */
function instability(): El[] {
	const els: El[] = [...grid([13.3, 26.7])];
	const BASE = 37;
	const cape = Array.from({ length: N }, (_, i) => {
		const burst = Math.max(0, noise(dayOf(i), 31) + 0.45);
		const evening = Math.exp(-((hourOf(i) - 16) ** 2) / 22);
		return Math.max(0, 30 * burst * evening + 2 * noise(i, 35) - 1);
	});
	for (let i = 0; i < N; i++) {
		if (cape[i] > 1.2) {
			els.push({ t: 'rect', x: xi(i) - 0.45, y: BASE - cape[i], w: 0.95, h: cape[i], fill: '#c584e2' });
		}
	}
	const REF = 15;
	els.push({ t: 'path', d: `M 0 ${REF} H 120`, stroke: '#cc5555', sw: 0.5, dash: '2 1.6' });
	const li = Array.from({ length: N }, (_, i) => REF - 0.16 * cape[i] - 2.2 * noise(i, 41) + 1.5);
	els.push({ t: 'path', d: seriesPath(li, true), stroke: '#c04848', sw: 0.9 });
	let dia = '';
	for (let i = 0; i < N; i += 2) {
		dia += `M ${xi(i)} ${li[i] - 0.9} l 0.9 0.9 l -0.9 0.9 l -0.9 -0.9 Z `;
	}
	els.push({ t: 'path', d: dia, stroke: '#c04848', sw: 0.45, fill: '#ffffff' });
	return els;
}

/* ---- 4 · SURFACE WIND: gust line, barb row, diurnal speed humps ---- */
function wind(): El[] {
	const els: El[] = [...grid()];
	els.push(barbRow(19, 6, 4));
	const gust = Array.from(
		{ length: N },
		(_, i) => 13 + 7 * noise(i, 51) + 3 * Math.sin(i * 0.11) - 3 * daybell(i) * noise(dayOf(i), 8)
	);
	const speed = Array.from(
		{ length: N },
		(_, i) => 34.5 - 9 * daybell(i) * (0.65 + 0.35 * noise(dayOf(i), 57)) - 1.2 * Math.abs(noise(i, 61))
	);
	els.push({ t: 'path', d: seriesPath(speed, true), stroke: '#e0a040', sw: 0.9 });
	let dia = '';
	for (let i = 0; i < N; i += 2) {
		dia += `M ${xi(i)} ${speed[i] - 0.8} l 0.8 0.8 l -0.8 0.8 l -0.8 -0.8 Z `;
	}
	els.push({ t: 'path', d: dia, stroke: '#e0a040', sw: 0.45, fill: '#ffffff' });
	els.push({ t: 'path', d: seriesPath(gust, true), stroke: '#cc0866', sw: 1.2 });
	return els;
}

/* ---- 5 · TEMPERATURE: yellow band, orange humps, hot caps, whiskers ---- */
function temperature(): El[] {
	const els: El[] = [...grid()];
	const dew = Array.from({ length: N }, (_, i) => 30.5 + 1.1 * noise(i, 71));
	const temp = Array.from({ length: N }, (_, i) => {
		const ph = 20 + 5 * noise(dayOf(i), 77);
		return Math.min(dew[i] - 0.5, 30 - ph * daybell(i) - 1.5 * Math.abs(noise(i, 81)) + 1.5);
	});
	const CAP = 13; // hotter than this renders as the deep-orange cap
	const aDew = area<number>()
		.x((_, i) => xi(i))
		.y0(40)
		.y1((d) => d);
	els.push({ t: 'path', d: aDew(dew) ?? '', fill: '#f6f6a4' });
	const aTemp = area<number>()
		.x((_, i) => xi(i))
		.y0((_, i) => dew[i])
		.y1((d) => d)
		.curve(curveMonotoneX);
	els.push({ t: 'path', d: aTemp(temp) ?? '', fill: '#f2a44c' });
	const aCap = area<number>()
		.x((_, i) => xi(i))
		.y0(CAP)
		.y1((d) => d)
		.defined((d) => d < CAP)
		.curve(curveMonotoneX);
	els.push({ t: 'path', d: aCap(temp) ?? '', fill: '#e05808' });
	// 3hr min/max whiskers
	let wk = '';
	for (let i = 0; i < N; i += 2) {
		const r = 1.2 + 2.6 * daybell(i) + Math.abs(noise(i, 87));
		const y0 = Math.max(1, temp[i] - r);
		const y1 = Math.min(dew[i] + 1.5, temp[i] + r);
		wk += `M ${xi(i)} ${y0} V ${y1} M ${xi(i) - 0.6} ${y0} h 1.2 M ${xi(i) - 0.6} ${y1} h 1.2 `;
	}
	els.push({ t: 'path', d: wk, stroke: '#8b8b8b', sw: 0.4 });
	els.push({ t: 'path', d: seriesPath(temp, true), stroke: '#7a4a24', sw: 0.8 });
	return els;
}

/* ---- 6 · HUMIDITY: banded green fill under the RH wave, dot markers ---- */
function humidity(): El[] {
	const els: El[] = [...grid()];
	const rh = Array.from(
		{ length: N },
		(_, i) => 7 + 19 * daybell(i) * (0.7 + 0.3 * noise(dayOf(i), 91)) + 1.6 * noise(i, 95)
	);
	// stepped green bands, dark at high RH fading down — clipped to the area
	const BANDS = [
		{ y: 0, h: 12, fill: '#16b431' },
		{ y: 12, h: 6, fill: '#43c64f' },
		{ y: 18, h: 6, fill: '#74d67c' },
		{ y: 24, h: 6, fill: '#a3e5a8' },
		{ y: 30, h: 10, fill: '#ccf0cf' }
	];
	for (const b of BANDS) {
		els.push({ t: 'rect', x: 0, y: b.y, w: 120, h: b.h, fill: b.fill, clip: true });
	}
	els.push({ t: 'path', d: seriesPath(rh, true), stroke: '#1d7c2a', sw: 0.9 });
	for (let i = 0; i < N; i += 3) {
		els.push({ t: 'circle', cx: xi(i), cy: rh[i], r: 0.8, fill: '#ffffff', stroke: '#1d7c2a', sw: 0.4 });
	}
	return els;
}

/* ---- 7 · CLOUD COVER: the panel this site reads, drawn exactly the way
   StationMeteogram.svelte draws it — chunky pixel columns per band on the
   map's sky blue, cloud tints pre-blended (theme.ts CLOUD), white dividers.
   Levels are real data: station GDG, 2026-07-06, downsampled to 40 columns. */
const CLOUD_LEVELS: Record<'high' | 'middle' | 'low', number[]> = {
	high: [6,6,6,6,6,6,6,6,2,4,6,5,1,3,1,1,4,5,6,6,6,6,6,6,6,6,6,4,5,5,6,5,6,5,6,5,6,5,3,6],
	middle: [1,0,2,6,2,1,1,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,5,2,0,4,0,0,2,5,1,0,0,0,0,0],
	low: [6,6,6,5,5,5,6,6,5,4,2,5,3,2,3,4,4,2,3,4,6,6,2,4,6,0,1,6,4,0,1,5,6,5,4,2,4,5,3,4]
};

function cloud(): El[] {
	const SKY = '#399DE1'; // UI.accent — the map's flat sky
	// theme.ts CLOUD tints flattened onto the sky (same math as flatten()):
	const FLAT = { high: 'rgb(152,204,239)', middle: 'rgb(177,205,234)', low: '#FFFFFF' };
	const LOW_SHADOW = '#C4D8EC';
	const els: El[] = [{ t: 'rect', x: 0, y: 0, w: 120, h: 40, fill: SKY }];
	const COLS = CLOUD_LEVELS.high.length;
	const LEVELS = 6;
	const bandH = 40 / 3;
	const GUTTER = 1.6;
	const ch = (bandH - GUTTER) / LEVELS;
	const cw = 120 / COLS;
	(['high', 'middle', 'low'] as const).forEach((key, band) => {
		const baseY = (band + 1) * bandH;
		for (let c = 0; c < COLS; c++) {
			const filled = CLOUD_LEVELS[key][c];
			if (!filled) continue;
			els.push({ t: 'rect', x: c * cw, y: baseY - filled * ch, w: cw, h: filled * ch, fill: FLAT[key] });
			// cumulus sits on a shaded base, same cue as the map's low marks
			if (key === 'low' && filled >= 2) {
				els.push({ t: 'rect', x: c * cw, y: baseY - ch / 2, w: cw, h: ch / 2, fill: LOW_SHADOW });
			}
		}
	});
	// day gridlines + band dividers, white like the station chart
	for (let d = 1; d < 10; d++) {
		els.push({ t: 'rect', x: (d * 120) / 10, y: 0, w: 0.25, h: 40, fill: '#ffffff', o: 0.18 });
	}
	els.push({ t: 'rect', x: 0, y: bandH, w: 120, h: 0.3, fill: '#ffffff', o: 0.5 });
	els.push({ t: 'rect', x: 0, y: bandH * 2, w: 120, h: 0.3, fill: '#ffffff', o: 0.5 });
	return els;
}

/* ---- 8 · PRECIPITATION: sparse paired bars over a quiet baseline ---- */
function precip(): El[] {
	const els: El[] = [...grid([10, 20, 30])];
	const BASE = 38.2;
	els.push({ t: 'path', d: `M 0 ${BASE} H 120`, stroke: '#9aa1ad', sw: 0.5 });
	for (let i = 0; i < N; i++) {
		const wet = noise(i, 131) + 0.7 * noise(dayOf(i), 149);
		if (wet > 0.28) {
			const h = 5 + 26 * (wet - 0.28) + 2 * Math.abs(noise(i, 141));
			els.push({ t: 'rect', x: xi(i) - 0.65, y: BASE - h, w: 0.7, h, fill: '#3cb844' });
			els.push({ t: 'rect', x: xi(i) + 0.1, y: BASE - h * 0.72, w: 0.7, h: h * 0.72, fill: '#e04838' });
		}
	}
	return els;
}

// Clip paths (by region id) applied to elements flagged `clip: true`.
export const MINI_CLIPS: Record<string, string> = {};
{
	const rh = Array.from(
		{ length: N },
		(_, i) => 7 + 19 * daybell(i) * (0.7 + 0.3 * noise(dayOf(i), 91)) + 1.6 * noise(i, 95)
	);
	const aRh = area<number>()
		.x((_, i) => xi(i))
		.y0(40)
		.y1((d) => d)
		.curve(curveMonotoneX);
	MINI_CLIPS.humidity = aRh(rh) ?? '';
}

export const MINIS: Record<string, El[]> = {
	'upper-air': upperAir(),
	pressure: pressure(),
	instability: instability(),
	wind: wind(),
	temperature: temperature(),
	humidity: humidity(),
	cloud: cloud(),
	precip: precip()
};
