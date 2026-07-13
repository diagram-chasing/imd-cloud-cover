// Animated share card: one frame per 3-hourly step of the latest day, cycling
// day into night — same camera fit and title placement as PixelMap at 1200x630.
// Usage: node scripts/build-sharecard.mjs

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { geoConicConformal } from 'd3-geo';
import { feature } from 'topojson-client';
import gifenc from 'gifenc';

const { GIFEncoder, quantize, applyPalette } = gifenc;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FONTS = resolve(ROOT, 'src/lib/assets/fonts');
const GROUND = resolve(ROOT, 'src/lib/assets/ground');
const OUT = resolve(ROOT, 'static/sharecard.gif');

const W = 1200;
const H = 630;
const FRAME_MS = 700;

// --- constants mirrored from theme.ts / PixelMap.svelte / sprites.ts ---------
const CELL = 8;
const WORLD_W = 1024;
const PAD = 4;
const MARK_CELL = 3;
const TOWER_GAP = MARK_CELL * 3.5;
const SHADOW_DROP = TOWER_GAP + MARK_CELL * 2.5;
const BIN0 = 24;
const MARK_VARIANTS = 3;
const BAND_KEYS = ['low', 'middle', 'high'];
const BAND_OFFSET = { high: -TOWER_GAP, middle: 0, low: TOWER_GAP };
const VAL_KEY = { high: 'h', middle: 'm', low: 'l' };

// daylight styling for every frame — only the clouds change through the day
const SKY = '#2E7CC4';
const CLOUD = {
	low: { fill: '#FFFFFF', shadow: '#C4D8EC', alpha: 1 },
	middle: { fill: '#B7CFEA', alpha: 0.95 },
	high: { fill: '#E6F2FB', alpha: 0.55 }
};
const MARK_ALPHA = { high: 0.55, middle: 0.95, low: 1 };
const TIER_ALPHA = [0.42, 0.6, 0.82, 1];
const SHADOW_FILL = '#0a1a28';
const SHADOW_ALPHA = 0.12;
const WAVE = { color: '#ffffff', alpha: 0.32 };
const WAVE_SCALE = 1.25;
const WAVE_MAX = 100;
const TITLE_ALPHA = 0.6;

const COVER_FLOOR = 20;
const COVER_GAMMA = 1.3;
function coverTier(cover) {
	if (cover < COVER_FLOOR) return 0;
	const t = (cover - COVER_FLOOR) / (100 - COVER_FLOOR);
	return Math.min(4, Math.max(1, Math.ceil(Math.pow(t, COVER_GAMMA) * 4)));
}

// --- hash/PRNG (map/hash.ts) --------------------------------------------------
function fnv1a(str) {
	let h = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}
function jitter(code, salt, range = 1) {
	return (fnv1a(code + salt) % (2 * range + 1)) - range;
}
function mulberry32(seed) {
	let a = seed >>> 0;
	return function () {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// --- sprite atlas (map/sprites.ts) --------------------------------------------
const SIZES = {
	low: [
		[4, 2],
		[5, 3],
		[7, 3],
		[8, 3]
	],
	middle: [
		[5, 2],
		[6, 2],
		[8, 2],
		[9, 2]
	]
};
const HIGH_W = [3, 5, 7, 9];

function puffProfile(rand, w, maxH, rough) {
	const peak = 0.5 + (rand() - 0.5) * 0.7;
	const h = [];
	for (let x = 0; x < w; x++) {
		const t = w > 1 ? x / (w - 1) : 0.5;
		const d = Math.abs(t - peak) / Math.max(peak, 1 - peak);
		const arch = Math.cos((d * Math.PI) / 2);
		h.push(Math.round(arch * maxH + (rand() - 0.5) * rough));
	}
	for (let x = 1; x < w - 1; x++) h[x] = Math.max(1, Math.min(maxH, h[x]));
	h[0] = Math.max(0, Math.min(1, h[0]));
	h[w - 1] = Math.max(0, Math.min(1, h[w - 1]));
	return h;
}
function profileToPattern(heights, rows) {
	const w = heights.length;
	const grid = Array.from({ length: rows }, () => new Array(w).fill(0));
	for (let x = 0; x < w; x++) {
		for (let y = rows - heights[x]; y < rows; y++) if (y >= 0) grid[y][x] = 1;
	}
	return grid;
}
function cirrusPattern(rand, w) {
	const grid = [new Array(w).fill(0), new Array(w).fill(0)];
	let x = 0;
	let drew = false;
	while (x < w) {
		if (rand() < 0.62) {
			const len = 1 + Math.floor(rand() * 2);
			const y = rand() < 0.5 ? 0 : 1;
			for (let i = 0; i < len && x + i < w; i++) grid[y][x + i] = 1;
			drew = true;
			x += len + 2 + Math.floor(rand() * 2);
		} else {
			x += 1 + Math.floor(rand() * 2);
		}
	}
	if (!drew) grid[0][0] = grid[0][Math.min(1, w - 1)] = 1;
	return grid;
}
function makePattern(band, tier, variant) {
	const rand = mulberry32(fnv1a(`${band}:${tier}:${variant}`));
	if (band === 'high') return cirrusPattern(rand, HIGH_W[tier - 1]);
	const [w, maxH] = SIZES[band][tier - 1];
	return profileToPattern(puffProfile(rand, w, maxH, band === 'low' ? 1.5 : 0.9), maxH);
}

// fill/alphaScale overrides let the same pattern double as the ground shadow
function drawMark(pattern, band, tier, cell, fill = null, alphaScale = 1) {
	const rows = pattern.length;
	const cols = Math.max(...pattern.map((r) => r.length));
	const canvas = createCanvas(cols * cell, rows * cell);
	const ctx = canvas.getContext('2d');
	ctx.imageSmoothingEnabled = false;
	ctx.globalAlpha = MARK_ALPHA[band] * TIER_ALPHA[tier - 1] * alphaScale;
	ctx.fillStyle = fill ?? CLOUD[band].fill;
	for (let y = 0; y < rows; y++) {
		for (let x = 0; x < cols; x++) {
			if (pattern[y][x]) ctx.fillRect(x * cell, y * cell, cell, cell);
		}
	}
	if (!fill && band === 'low' && rows >= 3) {
		ctx.fillStyle = CLOUD.low.shadow;
		for (let x = 0; x < cols; x++) {
			let by = -1;
			for (let y = 0; y < rows; y++) if (pattern[y][x]) by = y;
			if (by >= 0) ctx.fillRect(x * cell, by * cell, cell, cell);
		}
	}
	return canvas;
}

// --- data ---------------------------------------------------------------------
function readView(rel) {
	for (const dir of ['static/baked', 'static/sample']) {
		const p = resolve(ROOT, dir, rel);
		if (existsSync(p)) {
			try {
				return JSON.parse(readFileSync(p, 'utf8'));
			} catch {
				/* fall through */
			}
		}
	}
	return null;
}

const all = readView('latest/all-stations.json');
const manifest = readView('meta/stations.json');
if (!all?.stations || !manifest?.stations) {
	console.log('build-sharecard: missing all-stations/meta views — skipping.');
	process.exit(0);
}
const date = all.date;

GlobalFonts.registerFromPath(resolve(FONTS, 'ShipsWhistle-Bold.woff2'), 'Ships Whistle');
GlobalFonts.registerFromPath(resolve(FONTS, 'ShipsWhistle-Regular.woff2'), 'Ships Whistle');

// --- geo: projection, mask, stations (map/geo.ts) ------------------------------
const india = JSON.parse(readFileSync(resolve(ROOT, 'src/lib/assets/geo/india.json'), 'utf8'));
const indiaFC = feature(india, india.objects[Object.keys(india.objects)[0]]);

const worldH = WORLD_W * 1.06;
const gcell = CELL / 2; // DETAIL = 2 sub-cells per cloud cell

const maskImg = await loadImage(resolve(GROUND, 'ground-mask.png'));
const cols = maskImg.width;
const rows = maskImg.height;
{
	const c = createCanvas(cols, rows);
	c.getContext('2d').drawImage(maskImg, 0, 0);
	var maskPx = c.getContext('2d').getImageData(0, 0, cols, rows).data;
}
const land = new Uint8Array(cols * rows);
const shallow = new Uint8Array(cols * rows);
for (let i = 0; i < cols * rows; i++) {
	if (maskPx[i * 4] > 127) land[i] = 1;
	if (maskPx[i * 4 + 1] > 127) shallow[i] = 1;
}

const projection = geoConicConformal()
	.parallels([12, 36])
	.rotate([-82.5, 0])
	.fitExtent(
		[
			[CELL, CELL],
			[WORLD_W - CELL, worldH - CELL]
		],
		indiaFC
	);

const stations = [];
for (const [code, s] of Object.entries(manifest.stations)) {
	const p = projection([s.lon, s.lat]);
	if (!p) continue;
	stations.push({
		code,
		rpx: Math.max(0, Math.min(WORLD_W, p[0])),
		rpy: Math.max(0, Math.min(worldH, p[1]))
	});
}

// --- camera: a touch tighter than the static sharecard.jpg -----------------------
const zoom = 0.97;
const panX = 40;
const panY = 150;

// --- LOD0 bins (PixelMap buildBins, bin = 24) -----------------------------------
const binMap = new Map();
stations.forEach((st, i) => {
	const key = `${Math.floor(st.rpx / BIN0)},${Math.floor(st.rpy / BIN0)}`;
	let b = binMap.get(key);
	if (!b) {
		b = {
			px: (Math.floor(st.rpx / BIN0) + 0.5) * BIN0,
			py: (Math.floor(st.rpy / BIN0) + 0.5) * BIN0,
			members: [],
			code: st.code,
			variant: 0
		};
		binMap.set(key, b);
	}
	b.members.push(i);
});
for (const b of binMap.values()) {
	let best = Infinity;
	for (const i of b.members) {
		const st = stations[i];
		const d = (st.rpx - b.px) ** 2 + (st.rpy - b.py) ** 2;
		if (d < best) {
			best = d;
			b.code = st.code;
		}
	}
	b.px += jitter(b.code, 'jx', 3);
	b.py += jitter(b.code, 'jy', 2);
	b.variant = fnv1a(b.code) % MARK_VARIANTS;
}
const bins = [...binMap.values()].sort((a, b) => a.py - b.py);

function binCover(b, key, t) {
	let s = 0;
	let n = 0;
	for (const i of b.members) {
		const v = all.stations[stations[i].code];
		if (v) {
			s += v[key][t];
			n++;
		}
	}
	return n ? s / n : 0;
}

// --- prerendered textures -------------------------------------------------------
const cloudTex = { low: [], middle: [], high: [] };
const shadowTex = [];
for (const band of BAND_KEYS) {
	for (let tier = 1; tier <= 4; tier++) {
		cloudTex[band][tier] = [];
		for (let v = 0; v < MARK_VARIANTS; v++) {
			cloudTex[band][tier][v] = drawMark(makePattern(band, tier, v), band, tier, MARK_CELL);
		}
	}
}
for (let tier = 1; tier <= 4; tier++) {
	shadowTex[tier] = [];
	for (let v = 0; v < MARK_VARIANTS; v++) {
		shadowTex[tier][v] = drawMark(makePattern('low', tier, v), 'low', tier, MARK_CELL, SHADOW_FILL);
	}
}

const groundImg = await loadImage(resolve(GROUND, 'ground-day.png'));

// waves: deterministic sea sparkles in the lower half (PixelMap fillWaves)
const WAVE_CURVE = [1, 0, 0, 1, 2, 2, 1, 1];
const waves = [];
{
	const r = mulberry32(fnv1a('waves'));
	const marginX = Math.round(cols * 0.7);
	const cand = [];
	for (let y = Math.ceil(rows * 0.5); y < rows; y++) {
		for (let x = -marginX; x < cols + marginX; x++) {
			if (x >= 0 && x < cols) {
				const idx = y * cols + x;
				if (land[idx] || shallow[idx]) continue;
			}
			const p = 0.0022 * (y > rows * 0.62 ? 1.7 : 1);
			if (r() < p) cand.push({ x, y });
		}
	}
	for (let i = cand.length - 1; i > 0; i--) {
		const j = Math.floor(r() * (i + 1));
		[cand[i], cand[j]] = [cand[j], cand[i]];
	}
	for (const { x, y } of cand.slice(0, WAVE_MAX)) {
		waves.push({
			x: (x + 0.5) * gcell + (r() * 4 - 2),
			y: (y + 0.5) * gcell + (r() * 4 - 2),
			phase: Math.floor(r() * 4)
		});
	}
}

// pixel balloon (PixelMap buildBalloonTex)
const BALLOON_HALF = [2, 3, 4, 5, 6, 7, 7, 7, 7, 6, 6, 5, 5, 4, 4, 3, 3, 2, 1];
const BALLOON_SEAMS = [4, 7, 10];
function buildBalloonTex() {
	const cx = 7;
	const envH = BALLOON_HALF.length;
	const c = createCanvas(15, envH + 6);
	const ctx = c.getContext('2d');
	const W1 = '#ffffff';
	const W2 = '#c4ccd4';
	const W3 = '#e2e7ec';
	BALLOON_HALF.forEach((h, y) => {
		for (let x = cx - h; x <= cx + h; x++) {
			let col = W1;
			if (x === cx - h || x === cx + h || BALLOON_SEAMS.includes(x)) col = W2;
			else if (x > cx && ((x + y) & 1) === 0) col = W3;
			ctx.fillStyle = col;
			ctx.fillRect(x, y, 1, 1);
		}
	});
	ctx.fillStyle = W2;
	for (const y of [envH, envH + 1]) {
		ctx.fillRect(cx - 1, y, 1, 1);
		ctx.fillRect(cx + 1, y, 1, 1);
	}
	for (let y = envH + 2; y <= envH + 4; y++) {
		for (let x = cx - 1; x <= cx + 1; x++) {
			ctx.fillStyle = y === envH + 2 ? W1 : W2;
			ctx.fillRect(x, y, 1, 1);
		}
	}
	return c;
}
const balloonTex = buildBalloonTex();

// --- title block (PixelMap drawTitle, wide branch) ------------------------------
const STORY_TITLE = "MAPPING INDIA'S CLOUDS";
const STORY_SUB = "A daily map of where it's cloudy";
const BRAND = 'DIAGRAM CHASING';

const measureCtx = createCanvas(8, 8).getContext('2d');
function textW(text, px, weight, ls = 0) {
	measureCtx.font = `${weight >= 700 ? 'bold ' : ''}${px}px "Ships Whistle"`;
	return measureCtx.measureText(text).width + ls * Math.max(0, text.length - 1);
}

function layoutTitle() {
	const unit = 30;
	const pad = unit * 0.72;
	const gap = unit * 0.5;
	const rowGap = unit * 0.45;
	const lineH = (px) => px * 1.3; // ~Pixi text box height

	const titleFS = unit;
	const subFS = unit * 0.7;
	const brandFS = unit * 0.6;
	const brandLS = unit * 0.08;

	const titleWpx = textW(STORY_TITLE, titleFS, 700, unit * 0.02);
	const subWpx = textW(STORY_SUB, subFS, 400);
	const brandW = textW(BRAND, brandFS, 700, brandLS);
	const brandH = lineH(brandFS);
	const balloonH = brandH * 1.3;
	const balloonW = balloonH * (balloonTex.width / balloonTex.height);
	const brandRowH = Math.max(brandH, balloonH);
	const rowW = brandW + rowGap + balloonW;

	const innerW = Math.max(titleWpx, subWpx);
	const boxW = innerW + pad * 2;

	let by = brandRowH + gap * 0.4;
	const boxTop = by;
	by += pad;
	const titleY = by;
	by += lineH(titleFS) + gap;
	const subY = by;
	by += lineH(subFS);
	const boxBottom = by + pad;

	const groupW = Math.max(boxW, rowW);

	// screen-space placement: box ~400px wide, seated in the Bay of Bengal clear
	// of the coastline and inset from the card edges — centered on x=910 with
	// its top edge at y=450
	const s = 400 / boxW;
	const gx = 880 - (groupW / 2) * s;
	const gy = 380 - boxTop * s;

	return {
		unit,
		s,
		gx,
		gy,
		gcx: groupW / 2,
		titleFS,
		subFS,
		brandFS,
		brandLS,
		titleWpx,
		subWpx,
		brandW,
		brandRowH,
		rowW,
		rowGap,
		balloonW,
		balloonH,
		boxTop,
		boxW,
		boxH: boxBottom - boxTop,
		titleY,
		subY
	};
}

function fillText(ctx, text, px, weight, x, y, ls = 0) {
	const font = `${weight >= 700 ? 'bold ' : ''}${px}px "Ships Whistle"`;
	ctx.font = font;
	measureCtx.font = font;
	ctx.textBaseline = 'top';
	if (!ls) {
		ctx.fillText(text, x, y);
		return;
	}
	let cx = x;
	for (const ch of text) {
		ctx.fillText(ch, cx, y);
		cx += measureCtx.measureText(ch).width + ls;
	}
}

function drawTitle(ctx, frame) {
	const L = layoutTitle();
	ctx.save();
	ctx.globalAlpha = TITLE_ALPHA;
	ctx.translate(L.gx, L.gy);
	ctx.scale(L.s, L.s);
	ctx.fillStyle = '#ffffff';
	ctx.strokeStyle = '#ffffff';

	// brand row right-aligned to the box edge: wordmark + bobbing balloon
	const rowX0 = L.gcx + L.boxW / 2 - L.rowW;
	const brandCY = L.brandRowH / 2;
	fillText(
		ctx,
		BRAND,
		L.brandFS,
		700,
		rowX0,
		brandCY - (L.brandFS * 1.3) / 2 + L.brandFS * 0.15,
		L.brandLS
	);
	const bob = Math.sin((frame / 8) * Math.PI * 2) * 2;
	ctx.imageSmoothingEnabled = false;
	ctx.drawImage(
		balloonTex,
		rowX0 + L.brandW + L.rowGap,
		brandCY - L.balloonH / 2 + bob,
		L.balloonW,
		L.balloonH
	);

	// box + title + sub
	ctx.lineWidth = Math.max(1, L.unit * 0.045);
	ctx.strokeRect(L.gcx - L.boxW / 2, L.boxTop, L.boxW, L.boxH);
	fillText(
		ctx,
		STORY_TITLE,
		L.titleFS,
		700,
		L.gcx - L.titleWpx / 2,
		L.titleY + L.titleFS * 0.15,
		L.unit * 0.02
	);
	fillText(ctx, STORY_SUB, L.subFS, 400, L.gcx - L.subWpx / 2, L.subY + L.subFS * 0.15);
	ctx.restore();
}

// --- frame render ---------------------------------------------------------------
function drawSpriteCentered(ctx, tex, x, y, sy = 1) {
	ctx.drawImage(tex, x - tex.width / 2, y - (tex.height * sy) / 2, tex.width, tex.height * sy);
}

function renderFrame(t, frame) {
	const canvas = createCanvas(W, H);
	const ctx = canvas.getContext('2d');
	ctx.imageSmoothingEnabled = false;

	ctx.fillStyle = SKY;
	ctx.fillRect(0, 0, W, H);

	ctx.save();
	ctx.translate(-panX * zoom, -panY * zoom);
	ctx.scale(zoom, zoom);
	ctx.imageSmoothingEnabled = false;

	ctx.drawImage(groundImg, 0, 0, groundImg.width * gcell, groundImg.height * gcell);

	// ground shadows from effective cover; higher bands contribute less
	ctx.save();
	ctx.globalAlpha = SHADOW_ALPHA;
	for (const b of bins) {
		const eff = Math.max(
			binCover(b, 'l', t),
			binCover(b, 'm', t) * 0.8,
			binCover(b, 'h', t) * 0.45
		);
		const tier = coverTier(eff);
		if (!tier) continue;
		drawSpriteCentered(ctx, shadowTex[tier][b.variant], b.px + 2, b.py + SHADOW_DROP, 0.55);
	}
	ctx.restore();

	// waves toggle between the two curve phases each frame
	ctx.save();
	ctx.globalAlpha = WAVE.alpha;
	ctx.fillStyle = WAVE.color;
	const Wc = WAVE_CURVE.length;
	for (const w of waves) {
		const shift = (frame + w.phase) & 1;
		for (let x = 0; x < Wc; x++) {
			ctx.fillRect(
				w.x + (x - Wc / 2) * WAVE_SCALE,
				w.y + (WAVE_CURVE[(x + shift) % Wc] - 1.5) * WAVE_SCALE,
				WAVE_SCALE,
				WAVE_SCALE
			);
		}
	}
	ctx.restore();

	// cloud bands, low under middle under high; cirrus drifts east over the loop
	for (const band of BAND_KEYS) {
		const key = VAL_KEY[band];
		const driftX = band === 'high' ? (frame % 4) * 2 : 0;
		for (const b of bins) {
			const tier = coverTier(binCover(b, key, t));
			if (!tier) continue;
			drawSpriteCentered(
				ctx,
				cloudTex[band][tier][b.variant],
				b.px + driftX,
				b.py + BAND_OFFSET[band]
			);
		}
	}

	ctx.restore();

	// title block lives in screen space, over the empty sea to the east
	drawTitle(ctx, frame);
	return ctx.getImageData(0, 0, W, H).data;
}

// --- encode ----------------------------------------------------------------------
// One global palette + inter-frame diffing: pixels unchanged since the previous
// frame become the transparent index, so only the moving clouds cost bytes.
const STEP_ORDER = [0, 1, 2, 3, 4, 5, 6, 7];
const frames = STEP_ORDER.map((t, f) => renderFrame(t, f));

const sample = new Uint8Array(frames[0].length * 2);
sample.set(frames[0], 0);
sample.set(frames[4], frames[0].length);
const palette = quantize(sample, 255);
const TRANSPARENT = palette.length; // reserved slot, color never shown
palette.push([255, 0, 255]);

const gif = GIFEncoder();
let prev = null;
for (const rgba of frames) {
	const index = applyPalette(rgba, palette);
	if (!prev) {
		gif.writeFrame(index, W, H, { palette, delay: FRAME_MS });
	} else {
		const diff = index.slice();
		for (let p = 0; p < diff.length; p++) if (diff[p] === prev[p]) diff[p] = TRANSPARENT;
		gif.writeFrame(diff, W, H, {
			delay: FRAME_MS,
			transparent: true,
			transparentIndex: TRANSPARENT,
			dispose: 1
		});
	}
	prev = index;
}
gif.finish();
const buf = Buffer.from(gif.bytes());
writeFileSync(OUT, buf);
console.log(
	`build-sharecard: wrote sharecard.gif for ${date} (${STEP_ORDER.length} frames, ${(buf.length / 1024).toFixed(0)} KB).`
);
