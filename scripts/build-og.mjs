// Build one 1200x630 OG image per city. Runs after bake-data; degrades gracefully on missing data.
// Usage: node scripts/build-og.mjs

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { citySlugs } from '../src/lib/stations/slug.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'static/og');
const FONTS = resolve(ROOT, 'src/lib/assets/fonts');
const LOGO = resolve(ROOT, 'src/lib/assets/images/log.png');

// palette duplicated from theme.ts (no TS loader in node scripts)
const INK = '#0B1D3A';
const PAPER = '#FDFBF4';
const UI_ACCENT = '#399DE1'; // flat sky behind the clouds
const CLOUD = {
	high: { fill: '#E6F2FB', alpha: 0.55 },
	middle: { fill: '#B7CFEA', alpha: 0.95 },
	low: { fill: '#FFFFFF', shadow: '#C4D8EC', alpha: 1 }
};
const KEYS = ['high', 'middle', 'low'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// --- data read (prefer baked, fall back to committed sample) -----------------
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

const cities = readView('rollups/cities.json');
if (!cities?.cities) {
	console.log('build-og: no cities view (baked & sample) — skipping.');
	process.exit(0);
}
const summary = readView('latest/summary.json');
// OG_DATE overrides forecast date for local regeneration
const date = process.env.OG_DATE || summary?.date || cities.dates?.[cities.dates.length - 1] || '';

// font ships as woff2 only (no otf)
GlobalFonts.registerFromPath(resolve(FONTS, 'ShipsWhistle-Bold.woff2'), 'Ships Whistle');

const logo = await loadImage(LOGO).catch(() => null);

mkdirSync(OUT, { recursive: true });

// --- meteogram draw (ported from StationMeteogram.svelte) ---
function hexRgb(hex) {
	const h = hex.replace('#', '');
	return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function flatten(fg, bg, a) {
	const f = hexRgb(fg);
	const b = hexRgb(bg);
	const mix = (i) => Math.round(f[i] * a + b[i] * (1 - a));
	return `rgb(${mix(0)},${mix(1)},${mix(2)})`;
}
function colValue(fc, key, c, cols) {
	const n = fc.data.length;
	const a = Math.floor((c / cols) * n);
	const b = Math.max(a + 1, Math.floor(((c + 1) / cols) * n));
	let s = 0;
	let k = 0;
	for (let i = a; i < b && i < n; i++) {
		s += Math.max(0, Math.min(100, fc.data[i][key]));
		k++;
	}
	return k ? s / k / 100 : 0;
}
function dayTicks(fc) {
	const n = fc.data.length;
	const out = [];
	let prevDate = '';
	let prevMonth = -1;
	for (let i = 0; i < n; i++) {
		const iso = fc.data[i].datetime.slice(0, 10);
		if (iso === prevDate) continue;
		prevDate = iso;
		const [, m, d] = iso.split('-').map(Number);
		out.push({
			pct: (i / n) * 100,
			day: d,
			month: MONTHS[m - 1],
			showMonth: prevMonth !== -1 && m - 1 !== prevMonth,
			iso
		});
		prevMonth = m - 1;
	}
	return out;
}

// draws sky, three cloud bands, day gridlines, and HIGH/MID/LOW tags into (px,py,pw,ph)
function drawMeteogram(ctx, fc, px, py, pw, ph, today) {
	ctx.save();
	ctx.fillStyle = UI_ACCENT;
	ctx.fillRect(px, py, pw, ph);

	const ticks = fc && fc.data?.length ? dayTicks(fc) : [];

	if (fc && fc.data?.length) {
		const CELL = 18;
		const cols = Math.max(1, Math.round(pw / CELL));
		const cw = pw / cols;
		const bandH = ph / 3;
		const GUTTER = CELL;
		const effH = bandH - GUTTER;
		const levels = Math.max(3, Math.round(effH / CELL));
		const ch = effH / levels;

		KEYS.forEach((key, band) => {
			const conf = CLOUD[key];
			const shadow = 'shadow' in conf ? conf.shadow : null;
			const solid = flatten(conf.fill, UI_ACCENT, conf.alpha);
			const baseY = py + (band + 1) * bandH;
			for (let c = 0; c < cols; c++) {
				const filled = Math.round(colValue(fc, key, c, cols) * levels);
				if (!filled) continue;
				const x = px + Math.floor(c * cw);
				const w = Math.ceil(cw);
				const topY = baseY - filled * ch;
				ctx.fillStyle = solid;
				ctx.fillRect(x, topY, w, filled * ch);
				if (shadow && filled >= 2) {
					const sh = Math.max(1, Math.round(ch / 2));
					ctx.fillStyle = shadow;
					ctx.fillRect(x, baseY - sh, w, sh);
				}
			}
		});

		ctx.fillStyle = 'rgba(255,255,255,0.18)';
		for (const t of ticks) {
			if (t.pct <= 0) continue;
			ctx.fillRect(px + Math.round((t.pct / 100) * pw), py, 1, ph);
		}
		ctx.fillStyle = 'rgba(255,255,255,0.5)';
		ctx.fillRect(px, py + Math.round(bandH), pw, 1);
		ctx.fillRect(px, py + Math.round(bandH * 2), pw, 1);
	}

	ctx.fillStyle = INK;
	ctx.fillRect(px, py - 1, pw, 2);

	ctx.font = '20px "Ships Whistle"';
	ctx.textAlign = 'right';
	ctx.textBaseline = 'top';
	['HIGH', 'MID', 'LOW'].forEach((tag, i) => {
		const ty = py + i * (ph / 3) + 10;
		const tw = ctx.measureText(tag).width;
		ctx.fillStyle = 'rgba(253,251,244,0.82)';
		ctx.fillRect(px + pw - tw - 18, ty - 4, tw + 12, 26);
		ctx.fillStyle = INK;
		ctx.fillText(tag, px + pw - 12, ty);
	});
	ctx.restore();
}

function longDate(iso) {
	if (!iso) return '';
	const [y, m, d] = iso.split('-').map(Number);
	if (!y || !m || !d) return iso;
	return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
}

function render(city, forecast) {
	const W = 1200;
	const H = 630;
	const canvas = createCanvas(W, H);
	const ctx = canvas.getContext('2d');
	ctx.imageSmoothingEnabled = false;

	ctx.fillStyle = PAPER;
	ctx.fillRect(0, 0, W, H);
	ctx.strokeStyle = INK;
	ctx.lineWidth = 2;
	ctx.strokeRect(18, 18, W - 36, H - 36);

	const LEFT = 54;
	const RIGHT = W - 54;

	// date top-right, wordmark bottom-right: bookend the header
	ctx.font = '25px "Ships Whistle"';
	ctx.textAlign = 'right';
	ctx.textBaseline = 'alphabetic';
	ctx.fillStyle = 'rgba(11,29,58,0.55)';
	ctx.fillText(longDate(date), RIGHT, 66);
	if (logo) {
		const lh = 54;
		const lw = lh * (logo.width / logo.height);
		const padX = 16;
		const padY = 12;
		const boxW = lw + padX * 2;
		const boxH = lh + padY * 2;
		const boxX = RIGHT - boxW;
		const boxY = H / 2 - 16 - boxH; // seated just above the meteogram
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(boxX, boxY, boxW, boxH);
		ctx.strokeStyle = INK;
		ctx.lineWidth = 2;
		ctx.strokeRect(boxX, boxY, boxW, boxH);
		ctx.drawImage(logo, boxX + padX, boxY + padY, lw, lh);
	}

	const badge = "MAPPING INDIA'S CLOUDS";
	ctx.font = '24px "Ships Whistle"';
	ctx.textAlign = 'left';
	ctx.textBaseline = 'alphabetic';
	const badgeW = ctx.measureText(badge).width;
	ctx.fillStyle = UI_ACCENT;
	ctx.fillRect(LEFT, 40, badgeW + 28, 44);
	ctx.fillStyle = '#ffffff';
	ctx.fillText(badge, LEFT + 14, 70);

	const name = city.name.toUpperCase();
	let nameSize = 100;
	do {
		ctx.font = `${nameSize}px "Ships Whistle"`;
		if (ctx.measureText(name).width <= W - 2 * LEFT) break;
		nameSize -= 4;
	} while (nameSize > 44);
	ctx.fillStyle = INK;
	ctx.fillText(name, LEFT, 208);

	if (city.state) {
		ctx.font = '31px "Ships Whistle"';
		ctx.fillStyle = 'rgba(11,29,58,0.65)';
		ctx.fillText(city.state.toUpperCase(), LEFT, 252);
	}

	// meteogram fills the bottom half
	drawMeteogram(ctx, forecast, 20, H / 2, W - 40, H / 2 - 20, date);

	return canvas;
}

// --- run ---------------------------------------------------------------------
const { slugByCode } = citySlugs(cities.cities);
let ok = 0;
let empty = 0;
for (const [code, city] of Object.entries(cities.cities)) {
	const slug = slugByCode[code];
	const forecast = date ? readView(`${date}/${code}-meteogram.json`) : null;
	if (!forecast) empty++;
	try {
		const canvas = render(city, forecast);
		writeFileSync(resolve(OUT, `${slug}.png`), canvas.toBuffer('image/png'));
		ok++;
	} catch (err) {
		console.warn(`  build-og: ${slug} failed (${err.message})`);
	}
}
console.log(`build-og: wrote ${ok} images to static/og (${empty} with no forecast for ${date}).`);

// home.png: fallback card for homepage and station pages
try {
	const heroCode = Object.keys(cities.cities)[0];
	const heroForecast = date && heroCode ? readView(`${date}/${heroCode}-meteogram.json`) : null;
	const canvas = render({ name: 'India', state: null }, heroForecast);
	writeFileSync(resolve(OUT, 'home.png'), canvas.toBuffer('image/png'));
	console.log('build-og: wrote home.png (default share card).');
} catch (err) {
	console.warn(`  build-og: home.png failed (${err.message})`);
}
