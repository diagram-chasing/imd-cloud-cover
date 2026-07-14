import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { geoConicConformal } from 'd3-geo';
import { feature } from 'topojson-client';
import { citySlugs } from '../src/lib/stations/slug.js';
import {
	UI,
	CLOUD,
	MONTHS,
	prettyDate,
	skyCondition,
	haversineKm,
	buildTower,
	buildBalloonTex,
	makeReadView,
	SUN,
	SUN_W
} from './lib/pixel.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'static/og');
const FONTS = resolve(ROOT, 'src/lib/assets/fonts');

const W = 1200;
const H = 630;

// frame: 2px ink border at 18; content sits inside 20..W-20 / 20..H-20
const EDGE = 20;
const LEFT = 54;

// two columns: paper masthead + meteogram on the left, the regional map filling
// the full-height right column.
const MAP_X = 636;
const COL_R = MAP_X - 34; // right edge of the left (paper) column
const MET_X = LEFT;
const MET_W = COL_R - LEFT;
const MET_Y = 348;
const MET_H = 182;
const AXIS_Y = MET_Y + MET_H; // paper strip with the day labels

// regional map (CityMap.svelte constants; radius/cap from stations/[slug]/+page.server.ts)
const WORLD_W = 1024;
const WORLD_H = WORLD_W * 1.06;
const GEO_CELL = 8;
const RADIUS_KM = 100;
const MAP_CAP = 12;
const MAP_PAD = 1.6;
const MIN_SPAN_FACTOR = 0.02;
const CLOUD_PX = 8; // px per tower sprite cell
const DOT = 9;
const CLOUD_GAP = 6;
const MARKER_SEP = 66; // hide markers closer than this to a kept one (CityMap MIN_SEP)

const readView = makeReadView(ROOT);

// --- data ---------------------------------------------------------------------
const cities = readView('rollups/cities.json');
if (!cities?.cities) {
	console.log('build-og: no cities view (baked & sample) — skipping.');
	process.exit(0);
}
const summary = readView('latest/summary.json');
// OG_DATE overrides forecast date for local regeneration
const date = process.env.OG_DATE || summary?.date || cities.dates?.[cities.dates.length - 1] || '';

// today's {h,m,l} per station: daily mean of the 8 three-hourly steps
const all = readView('latest/all-stations.json');
const meanValues = {};
if (all?.stations) {
	const mean = (a) => Math.round(a.reduce((s, v) => s + v, 0) / (a.length || 1));
	for (const [code, v] of Object.entries(all.stations)) {
		meanValues[code] = { h: mean(v.h), m: mean(v.m), l: mean(v.l) };
	}
}

const manifest = readView('meta/stations.json');

GlobalFonts.registerFromPath(resolve(FONTS, 'ShipsWhistle-Bold.woff2'), 'Ships Whistle');
GlobalFonts.registerFromPath(resolve(FONTS, 'ShipsWhistle-Regular.woff2'), 'Ships Whistle');

// geo for the map panel; when any piece is missing the card renders without it
let geo = null;
try {
	const topo = JSON.parse(readFileSync(resolve(ROOT, 'src/lib/assets/geo/india.json'), 'utf8'));
	const indiaFC = feature(topo, topo.objects[Object.keys(topo.objects)[0]]);
	const projection = geoConicConformal()
		.parallels([12, 36])
		.rotate([-82.5, 0])
		.fitExtent(
			[
				[GEO_CELL, GEO_CELL],
				[WORLD_W - GEO_CELL, WORLD_H - GEO_CELL]
			],
			indiaFC
		);
	const groundImg = await loadImage(resolve(ROOT, 'src/lib/assets/ground/ground-day.png'));
	geo = { projection, groundImg, gscale: WORLD_W / groundImg.width };
} catch (err) {
	console.warn(`build-og: map panel disabled (${err.message})`);
}

const balloonTex = buildBalloonTex();
const towerCache = new Map();
function towerFor(code) {
	let t = towerCache.get(code);
	if (!t) {
		t = buildTower(code, meanValues[code] ?? null);
		towerCache.set(code, t);
	}
	return t;
}

// own station always included (flagged primary); others within RADIUS_KM, nearest first
function nearbyStations(code) {
	const own = manifest?.stations?.[code];
	if (!own) return null;
	const scored = [];
	for (const [c, s] of Object.entries(manifest.stations)) {
		const km = haversineKm(own.lat, own.lon, s.lat, s.lon);
		if (c === code || km <= RADIUS_KM) {
			scored.push({ code: c, name: s.name, lat: s.lat, lon: s.lon, km, primary: c === code });
		}
	}
	scored.sort((a, b) => a.km - b.km);
	return scored.slice(0, MAP_CAP);
}

// --- text helpers ----------------------------------------------------------------
function font(ctx, px, weight = 400) {
	ctx.font = `${weight >= 700 ? 'bold ' : ''}${px}px "Ships Whistle"`;
}
// manual letterspacing (canvas has none); returns the advanced width
function fillTextLS(ctx, text, x, y, ls) {
	let cx = x;
	for (const ch of text) {
		ctx.fillText(ch, cx, y);
		cx += ctx.measureText(ch).width + ls;
	}
	return cx - ls - x;
}
function measureLS(ctx, text, ls) {
	return ctx.measureText(text).width + ls * Math.max(0, text.length - 1);
}
// the map's text-shadow-sky: a one-pixel ink drop so white text keeps its edge
function skyText(ctx, text, x, y, fill, ls = 0) {
	ctx.fillStyle = 'rgba(11,29,58,0.9)';
	fillTextLS(ctx, text, x + 2, y + 2, ls);
	ctx.fillStyle = fill;
	fillTextLS(ctx, text, x, y, ls);
}

// --- tower / sun glyphs ------------------------------------------------------------
function drawTowerCells(ctx, tower, x, y, cell, shadow = true) {
	if (shadow) {
		for (const c of tower.cells) {
			ctx.globalAlpha = 0.3 * c.opacity;
			ctx.fillStyle = UI.ink;
			ctx.fillRect(x + c.x * cell, y + c.y * cell + 2, cell, cell);
		}
	}
	for (const c of tower.cells) {
		ctx.globalAlpha = c.opacity;
		ctx.fillStyle = c.fill;
		ctx.fillRect(x + c.x * cell, y + c.y * cell, cell, cell);
	}
	ctx.globalAlpha = 1;
}
function drawSun(ctx, x, y, cell) {
	ctx.fillStyle = UI.sunGold;
	for (const [sx, sy] of SUN) ctx.fillRect(x + sx * cell, y + sy * cell, cell, cell);
}

// A station's sky as a glyph in a day-sea box, sitting next to the masthead name
// — the map's cloud tower, or a pixel sun when clear. Box left edge at `x`,
// vertically centred on `cy`, sized `box`.
const NAME_BOX_MAX = 82;
function drawNameGlyph(ctx, code, values, x, cy, box) {
	const by = Math.round(cy - box / 2);
	ctx.fillStyle = UI.daySea;
	ctx.fillRect(x, by, box, box);
	ctx.strokeStyle = UI.ink;
	ctx.lineWidth = 2;
	ctx.strokeRect(x, by, box, box);
	const tower = code ? towerFor(code) : buildTower('', values);
	const inner = box - 18;
	if (tower.cells.length) {
		const cell = Math.max(3, Math.min(9, Math.floor(inner / Math.max(tower.w, tower.h))));
		drawTowerCells(
			ctx,
			tower,
			x + Math.round((box - tower.w * cell) / 2),
			by + Math.round((box - tower.h * cell) / 2),
			cell,
			false
		);
	} else {
		const cell = Math.max(3, Math.floor(inner / SUN_W));
		drawSun(ctx, x + (box - SUN_W * cell) / 2, by + (box - SUN_W * cell) / 2, cell);
	}
}

// --- regional map panel (CityMap.svelte) ------------------------------------------------
function drawCityMap(ctx, stations, px, py, pw, ph) {
	ctx.save();
	ctx.beginPath();
	ctx.rect(px, py, pw, ph);
	ctx.clip();
	ctx.fillStyle = UI.daySea;
	ctx.fillRect(px, py, pw, ph);

	const pts = [];
	for (const s of stations) {
		const p = geo.projection([s.lon, s.lat]);
		if (p) pts.push({ ...s, x: p[0], y: p[1] });
	}
	if (pts.length) {
		// crop window: station bbox + padding; floor keeps dense clusters from collapsing
		let minX = Infinity,
			maxX = -Infinity,
			minY = Infinity,
			maxY = -Infinity;
		for (const p of pts) {
			if (p.x < minX) minX = p.x;
			if (p.x > maxX) maxX = p.x;
			if (p.y < minY) minY = p.y;
			if (p.y > maxY) maxY = p.y;
		}
		const aspect = pw / ph;
		let S = Math.max(
			(maxX - minX) * MAP_PAD,
			(maxY - minY) * aspect * MAP_PAD,
			WORLD_W * MIN_SPAN_FACTOR
		);
		S = Math.min(S, WORLD_W);
		const Sy = S / aspect;
		const wx = Math.max(0, Math.min(WORLD_W - S, (minX + maxX) / 2 - S / 2));
		const wy = Math.max(0, Math.min(WORLD_H - Sy, (minY + maxY) / 2 - Sy / 2));
		const k = pw / S;

		ctx.imageSmoothingEnabled = false;
		ctx.globalAlpha = 0.9;
		const g = geo.groundImg;
		ctx.drawImage(
			g,
			px - wx * k,
			py - wy * k,
			g.width * geo.gscale * k,
			g.height * geo.gscale * k
		);
		ctx.globalAlpha = 1;

		// screen-space markers; drop non-primary ones crowding a kept neighbour
		const markers = [];
		for (const p of pts) {
			const sx = px + (p.x - wx) * k;
			const sy = py + (p.y - wy) * k;
			if (
				!p.primary &&
				markers.some((q) => Math.hypot(q.sx - sx, q.sy - sy) < MARKER_SEP)
			) {
				continue;
			}
			markers.push({ ...p, sx, sy });
		}

		// towers north-to-south so southern sprites overlap like the big map
		for (const m of [...markers].sort((a, b) => a.sy - b.sy)) {
			const tower = towerFor(m.code);
			if (tower.cells.length) {
				drawTowerCells(
					ctx,
					tower,
					Math.round(m.sx - (tower.w * CLOUD_PX) / 2),
					Math.round(m.sy - CLOUD_GAP - tower.h * CLOUD_PX),
					CLOUD_PX
				);
			}
			ctx.beginPath();
			ctx.arc(m.sx, m.sy, DOT / 2, 0, Math.PI * 2);
			ctx.fillStyle = m.primary ? UI.sunGold : '#ffffff';
			ctx.fill();
			ctx.strokeStyle = 'rgba(11,29,58,0.8)';
			ctx.lineWidth = 2;
			ctx.stroke();
		}

		// labels: primary first, then nearest; below-first placement, skip on collision
		font(ctx, 22, 700);
		const LABEL_H = 24;
		const taken = markers.map((m) => {
			const tower = towerFor(m.code);
			const tw = Math.max(tower.w * CLOUD_PX, 18);
			const th = tower.h * CLOUD_PX + CLOUD_GAP + DOT;
			return { l: m.sx - tw / 2, r: m.sx + tw / 2, t: m.sy - th, b: m.sy + DOT / 2 };
		});
		const hit = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
		let labelled = 0;
		const seenNames = new Set();
		for (const m of [...markers].sort((a, b) => (a.primary ? -1 : b.primary ? 1 : a.km - b.km))) {
			if (labelled >= 8) break;
			const text = m.name.toUpperCase();
			if (seenNames.has(text)) continue; // twin IMD stations share a name — label once
			seenNames.add(text);
			const w = measureLS(ctx, text, 1);
			const tower = towerFor(m.code);
			const topY = m.sy - CLOUD_GAP - tower.h * CLOUD_PX;
			const spots = [
				{ x: m.sx - w / 2, y: m.sy + DOT / 2 + 6 },
				{ x: m.sx - w / 2, y: topY - 6 - LABEL_H },
				{ x: m.sx + DOT + 8, y: m.sy - LABEL_H / 2 },
				{ x: m.sx - DOT - 8 - w, y: m.sy - LABEL_H / 2 }
			];
			for (const sp of spots) {
				const box = { l: sp.x - 3, r: sp.x + w + 3, t: sp.y - 2, b: sp.y + LABEL_H + 2 };
				if (
					box.l < px + 8 ||
					box.r > px + pw - 8 ||
					box.t < py + 8 ||
					box.b > py + ph - 8 ||
					taken.some((o) => hit(box, o))
				) {
					continue;
				}
				skyText(ctx, text, sp.x, sp.y + LABEL_H - 6, m.primary ? UI.sunGold : '#ffffff', 1);
				taken.push(box);
				labelled++;
				break;
			}
		}
	}

	// a bottom-edge fade over the sea, matching the homepage map-frame's gradient
	// scrim — seats the wordmark and keeps it legible without a boxed-in look
	const gh = Math.min(190, ph * 0.42);
	const grad = ctx.createLinearGradient(0, py + ph - gh, 0, py + ph);
	grad.addColorStop(0, 'rgba(8,24,49,0)');
	grad.addColorStop(0.6, 'rgba(8,24,49,0.28)');
	grad.addColorStop(1, 'rgba(8,24,49,0.62)');
	ctx.fillStyle = grad;
	ctx.fillRect(px, py + ph - gh, pw, gh);

	// wordmark + bobbing balloon riding the fade, bottom-right (big map title block)
	font(ctx, 23, 700);
	const brand = 'DIAGRAM CHASING';
	const bh = 36;
	const bw = bh * (balloonTex.width / balloonTex.height);
	const tw = measureLS(ctx, brand, 2);
	const baseY = py + ph - 24;
	const bx = px + pw - 22 - tw - 12 - bw;
	skyText(ctx, brand, bx, baseY, '#ffffff', 2);
	ctx.imageSmoothingEnabled = false;
	ctx.drawImage(balloonTex, bx + tw + 12, baseY - bh + 4, bw, bh);

	ctx.restore();
	ctx.strokeStyle = UI.ink;
	ctx.lineWidth = 2;
	ctx.strokeRect(px, py, pw, ph);
}

// --- meteogram (StationMeteogram.svelte) ---------------------------------------------
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
const BAND_KEYS = ['high', 'middle', 'low'];

function drawMeteogram(ctx, fc, ticks, px, py, pw, ph) {
	ctx.save();
	ctx.fillStyle = UI.accent;
	ctx.fillRect(px, py, pw, ph);

	const bandH = ph / 3;
	if (fc && fc.data?.length) {
		const CELL = 18;
		const cols = Math.max(1, Math.round(pw / CELL));
		const cw = pw / cols;
		const GUTTER = CELL;
		const effH = bandH - GUTTER;
		const levels = Math.max(3, Math.round(effH / CELL));
		const ch = effH / levels;

		BAND_KEYS.forEach((key, band) => {
			const conf = CLOUD[key];
			const shadow = 'shadow' in conf ? conf.shadow : null;
			const solid = flatten(conf.fill, UI.accent, conf.alpha);
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
	} else {
		// faint dotted baseline in each band as a placeholder footprint
		ctx.fillStyle = 'rgba(255,255,255,0.09)';
		for (let band = 0; band < 3; band++) {
			const y = py + Math.round((band + 1) * bandH) - 10;
			for (let x = 0; x < pw; x += 20) ctx.fillRect(px + x, y, 10, 10);
		}
	}

	ctx.fillStyle = 'rgba(255,255,255,0.5)';
	ctx.fillRect(px, py + Math.round(bandH), pw, 1);
	ctx.fillRect(px, py + Math.round(bandH * 2), pw, 1);

	ctx.fillStyle = UI.ink;
	ctx.fillRect(px, py - 1, pw, 2);
	ctx.restore();
}

// day axis on paper below the chart; today wears the sun-gold plate
function drawAxis(ctx, ticks, px, py, pw) {
	ctx.save();
	ctx.textBaseline = 'alphabetic';
	for (const t of ticks) {
		const x = px + (t.pct / 100) * pw;
		const label = `${t.day}${t.showMonth ? ' ' + t.month : ''}`;
		const today = t.iso === date;
		font(ctx, 20, today ? 700 : 400);
		const w = ctx.measureText(label).width;
		// first tick left-aligns (page: first:translate-x-0); others centre on the mark
		const lx = t.pct <= 0 ? x : Math.min(x - w / 2, px + pw - w - 4);
		ctx.fillStyle = today ? UI.sunGold : 'rgba(11,29,58,0.4)';
		ctx.fillRect(Math.round(x), py + 6, 2, today ? 10 : 7);
		if (today) {
			ctx.fillStyle = UI.sunGold;
			ctx.fillRect(lx - 6, py + 20, w + 12, 28);
		}
		ctx.fillStyle = today ? UI.ink : 'rgba(11,29,58,0.6)';
		ctx.fillText(label, lx, py + 41);
	}
	ctx.restore();
}

// --- card ------------------------------------------------------------------------
function render(city, forecast, extras) {
	const { code, own, stations } = extras;
	const canvas = createCanvas(W, H);
	const ctx = canvas.getContext('2d');
	ctx.imageSmoothingEnabled = false;
	ctx.textBaseline = 'alphabetic';

	ctx.fillStyle = UI.paper;
	ctx.fillRect(0, 0, W, H);

	const hasMap = !!(geo && stations?.length);
	const values = code ? (meanValues[code] ?? null) : null;
	// with a map, the paper column stops at COL_R; without one it runs full width
	const colR = hasMap ? COL_R : W - LEFT;

	// badge + date bookend the top row of the paper column
	const badge = "MAPPING INDIA'S CLOUDS";
	font(ctx, 23, 700);
	ctx.textAlign = 'left';
	const badgeW = measureLS(ctx, badge, 0.5);
	ctx.fillStyle = UI.accent;
	ctx.fillRect(LEFT, 38, badgeW + 28, 42);
	ctx.fillStyle = '#ffffff';
	fillTextLS(ctx, badge, LEFT + 14, 66, 0.5);

	font(ctx, 24, 400);
	ctx.textAlign = 'right';
	ctx.fillStyle = 'rgba(11,29,58,0.55)';
	ctx.fillText(prettyDate(date), colR, 66);
	ctx.textAlign = 'left';

	// masthead: name + state grouped as a title/subtitle at the top of the column;
	// the condition drops to a lede just above the meteogram (below). The name
	// auto-scales to fill the width left of the sky-glyph box.
	const GLYPH_GAP = 24;
	const GLYPH_RESERVE = values ? NAME_BOX_MAX + GLYPH_GAP : 0;
	const name = city.name.toUpperCase();
	const nameTop = 128;
	let nameSize = 100;
	do {
		font(ctx, nameSize, 700);
		if (measureLS(ctx, name, 1) <= colR - LEFT - GLYPH_RESERVE) break;
		nameSize -= 2;
	} while (nameSize > 34);
	const nameBaseline = nameTop + nameSize * 0.74;
	ctx.fillStyle = UI.ink;
	const nameW = fillTextLS(ctx, name, LEFT, nameBaseline, 1);

	if (values) {
		const box = Math.round(Math.min(NAME_BOX_MAX, Math.max(52, nameSize * 0.8)));
		const gx = Math.min(LEFT + nameW + GLYPH_GAP, colR - box);
		drawNameGlyph(ctx, code, values, gx, nameTop + nameSize * 0.35, box);
	}

	if (city.state) {
		font(ctx, 26, 400);
		ctx.fillStyle = UI.ink;
		fillTextLS(ctx, city.state.toUpperCase(), LEFT, nameBaseline + Math.max(38, nameSize * 0.42), 0.5);
	}

	if (values) {
		// lede: sits just above the chart it describes (StationMeteogram)
		font(ctx, 26, 700);
		ctx.fillStyle = UI.ink;
		fillTextLS(ctx, skyCondition(values), LEFT, MET_Y - 26, 1);
	}

	if (hasMap) {
		drawCityMap(ctx, stations, MAP_X, EDGE, W - EDGE - MAP_X, H - 2 * EDGE);
	}

	// meteogram sits in the left column beside the map; without a map it spans full width
	const metW = hasMap ? MET_W : W - 2 * LEFT;
	const ticks = forecast?.data?.length ? dayTicks(forecast) : [];
	drawMeteogram(ctx, forecast, ticks, MET_X, MET_Y, metW, MET_H);
	if (ticks.length) drawAxis(ctx, ticks, MET_X, AXIS_Y, metW);

	ctx.strokeStyle = UI.ink;
	ctx.lineWidth = 2;
	// ctx.strokeRect(18, 18, W - 36, H - 36);

	return canvas;
}

// --- run ---------------------------------------------------------------------
// One card per station page: city-backed stations are keyed by slug (consumed by
// /stations/[slug]); the rest by code (consumed by /station/[code]). Manifest is
// the superset, so a single pass covers both routes.
mkdirSync(OUT, { recursive: true });
const { slugByCode } = citySlugs(cities.cities);
const roster = manifest?.stations
	? Object.keys(manifest.stations)
	: Object.keys(cities.cities);
let ok = 0;
let empty = 0;
for (const code of roster) {
	const outName = slugByCode[code] ?? code;
	const city = cities.cities[code] ?? {
		name: manifest.stations[code]?.name ?? code,
		state: manifest.stations[code]?.state ?? null
	};
	const forecast = date ? readView(`${date}/${code}-meteogram.json`) : null;
	if (!forecast) empty++;
	try {
		const canvas = render(city, forecast, {
			code,
			own: manifest?.stations?.[code] ?? null,
			stations: nearbyStations(code)
		});
		writeFileSync(resolve(OUT, `${outName}.png`), canvas.toBuffer('image/png'));
		ok++;
	} catch (err) {
		console.warn(`  build-og: ${outName} failed (${err.message})`);
	}
}
console.log(`build-og: wrote ${ok} images to static/og (${empty} with no forecast for ${date}).`);
