// THROWAWAY generator for the "More From Us" islands:
//   src/lib/assets/cards/world-map.png           (landscape - desktop)
//   src/lib/assets/cards/world-map-portrait.png  (vertical  - mobile)
// The islands are hand-drawn as ASCII grids (X = land, ~ = river, space = open
// sea/transparent). We rasterize each verbatim: land becomes dithered grass with
// a crisp coastal sand ring where it meets the sea, the ~ path becomes water
// tiles (a river) with lighter shallows at its banks, and pixel trees scatter
// across the grass. Delete after baking; only the PNGs are kept.
import { PNG } from 'pngjs';
import { writeFileSync } from 'node:fs';

const SCALE = 8; // px per grid cell
const SAND_W = 2; // px band of coast (thin outline)
const hash = (a, b) => ((a * 73856093) ^ (b * 19349663)) >>> 0;

// --- Palette (PixelMap / theme.ts). --------------------------------------
const C = {
	grassA: [0x5b, 0x8c, 0x6e],
	grassB: [0x6a, 0x99, 0x7c],
	grassLt: [0x77, 0xa6, 0x89],
	sand: [0xe7, 0xd6, 0xa8],
	sandEdge: [0xcf, 0xb9, 0x84],
	water: [0x6f, 0xc4, 0xef],
	shallow: [0x8f, 0xcb, 0xef],
	wave: [0xff, 0xff, 0xff],
	canopyD: [0x3e, 0x6b, 0x54],
	canopyL: [0x4f, 0x7e, 0x63],
	trunk: [0x5a, 0x46, 0x30]
};

const canopy = [
	[0, 0, 1, 1, 1, 0, 0],
	[0, 1, 1, 1, 1, 1, 0],
	[1, 1, 2, 1, 1, 2, 1],
	[1, 1, 1, 1, 1, 1, 1],
	[0, 1, 1, 1, 1, 1, 0],
	[0, 0, 1, 1, 1, 0, 0]
];

// Rasterize one ASCII island. `cities` are [normX, normY] anchors kept clear of
// trees so a pin/plaque can sit there; they MUST match SiteFooter.svelte.
function bake(grid, cities, outPath) {
	const COLS = Math.max(...grid.map((r) => r.length));
	const ROWS = grid.length;
	const W = COLS * SCALE;
	const H = ROWS * SCALE;

	const cellAt = (cx, cy) =>
		cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS ? ' ' : grid[cy][cx] || ' ';
	// Math.floor (not |0): x/y < 0 must map to negative cell, not cell 0
	// (otherwise land flush to canvas edge never registers as coastline)
	const kindAtPx = (px, py) => cellAt(Math.floor(px / SCALE), Math.floor(py / SCALE));
	const isLand = (px, py) => kindAtPx(px, py) === 'X';
	const isRiver = (px, py) => kindAtPx(px, py) === '~';
	const isSea = (px, py) => kindAtPx(px, py) === ' ';

	const png = new PNG({ width: W, height: H });
	const put = (x, y, [r, g, b], a = 255) => {
		if (x < 0 || y < 0 || x >= W || y >= H) return;
		const i = (y * W + x) << 2;
		png.data[i] = r;
		png.data[i + 1] = g;
		png.data[i + 2] = b;
		png.data[i + 3] = a;
	};

	const near = (px, py, r, pred) => {
		for (let dy = -r; dy <= r; dy++)
			for (let dx = -r; dx <= r; dx++) if (pred(px + dx, py + dy)) return true;
		return false;
	};
	const nearSea = (px, py, r) => near(px, py, r, isSea);
	const nearLand = (px, py, r) => near(px, py, r, isLand);
	// explicit waterline so dark coast ring wraps every side (distance band alone is too thin)
	const isWaterline = (px, py) =>
		isLand(px, py) &&
		(isSea(px - 1, py) ||
			isSea(px + 1, py) ||
			isSea(px, py - 1) ||
			isSea(px, py + 1) ||
			isSea(px - 1, py - 1) ||
			isSea(px + 1, py - 1) ||
			isSea(px - 1, py + 1) ||
			isSea(px + 1, py + 1));

	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			const k = kindAtPx(x, y);
			if (k === ' ') continue; // transparent sea

			if (k === '~') {
				const bank = nearLand(x, y, 2);
				let col = bank ? C.shallow : C.water;
				if (!bank && hash(x * 3, y * 5) % 23 === 0) col = C.wave;
				put(x, y, col);
				continue;
			}

			if (isWaterline(x, y)) {
				put(x, y, C.sandEdge); // crisp dark ring on every coast pixel
				continue;
			}
			if (nearSea(x, y, SAND_W)) {
				put(x, y, C.sand); // light beach just inland of the waterline
				continue;
			}
			// Grass: 8px checker of two greens + a sparse lighter fleck.
			const check = (((x >> 2) + (y >> 2)) & 1) === 0;
			let col = check ? C.grassA : C.grassB;
			if (hash(x, y) % 17 === 0) col = C.grassLt;
			put(x, y, col);
		}
	}

	// Trees: scatter over inland grass, off the coast and off the city anchors.
	const cityPx = cities.map(([nx, ny]) => [nx * W, ny * H]);
	const nearCity = (px, py) => cityPx.some(([cx, cy]) => Math.hypot(px - cx, py - cy) < 26);
	const drawTree = (px, py) => {
		for (let ry = 0; ry < canopy.length; ry++)
			for (let rx = 0; rx < canopy[ry].length; rx++) {
				if (!canopy[ry][rx]) continue;
				put(px + rx - 3, py + ry - 3, canopy[ry][rx] === 2 ? C.canopyL : C.canopyD);
			}
		put(px, py + 4, C.trunk);
		put(px, py + 5, C.trunk);
	};

	const planted = [];
	for (let cy = 0; cy < ROWS; cy++) {
		for (let cx = 0; cx < COLS; cx++) {
			if (cellAt(cx, cy) !== 'X') continue;
			if (hash(cx * 11 + 1, cy * 7 + 3) % 6 !== 0) continue; // ~1 in 6 cells
			const px = cx * SCALE + 4;
			const py = cy * SCALE + 4;
			if (nearSea(px, py, SAND_W + 3)) continue; // keep off the beach
			if (isRiver(px, py) || nearCity(px, py)) continue;
			if (planted.some(([qx, qy]) => Math.hypot(px - qx, py - qy) < 12)) continue;
			drawTree(px, py);
			planted.push([px, py]);
		}
	}

	writeFileSync(outPath, PNG.sync.write(png));
	console.log(`baked ${outPath} ${W}x${H}, ${planted.length} trees`);
}

// --- Landscape island (desktop). -----------------------------------------
// Cities: one project on each landmass, either side of the river.
bake(
	[
		'XXXXXXXX~          XXXXXXXXXX',
		'XXXXXXXX~XXXX     XXXXXXXXXXX',
		'XXXXXXXX~~XXXXXXXXXXXXXXXXXXX',
		'XXXXXXXXX~~XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
		'XXXXXXXXXX~~~~XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
		'XXXXXXXXXXXXXX~~~~~~XXXXXXXXXXXXXXXXXXXXXXXXXXXX',
		'XXXXXXXXXXXXXXXXXXX~~XXXXXXXXXXXXXXXXXXXXXXXXXXX',
		'XXXXXXXXXXXXXXXXXXXX~XXXXXXXXXXXXXXXXXXXXXXXXXXX',
		'XXXXXXXXXXXXXXXXXXXX~XXXXXXXXXXXXXXXXXXXXXXXXXXX',
		'XXXXXXXXXXXXXXXXXXXX~XXXXXXXXXXXXXXXXXXXXXXXXXXX',
		'   XXXXXXXXXXXXXXXXX~XXXXXXXXXXXXXXXXXXXXXXXXXXX',
		'         XXXXXXXXXXX~XXXXXXXXXXXXXXXXXXXXXXXXXXX',
		'         XXXXXXXXXXX~XXXXXXXXXXXXXXXXXXXXXXXXXXX',
		'         XXXXXXXXXXX~~XXXXXXXX',
		'            XXXXXXXXX~~~',
		'            XXXXXXXXXXXX'
	],
	[
		[0.24, 0.8],
		[0.76, 0.64]
	],
	'src/lib/assets/cards/world-map.png'
);

// --- Portrait island (mobile). -------------------------------------------
// A tall landmass with the river snaking down the left third; both projects pin
// to the broad centre so their (large) cards stay centred on a narrow screen.
// Stacked far apart vertically (~20% / ~80%) to clear the taller cards.
bake(
	[
		'      XXXX      ',
		'    XXXXXXXXX   ',
		'   XXXXXXXXXXX  ',
		'  XXX~XXXXXXXX  ',
		'  XX~~XXXXXXXXX ',
		' XXX~XXXXXXXXXX ',
		' XX~~XXXXXXXXXX ',
		' XX~XXXXXXXXXXX ',
		' XX~XXXXXXXXXXX ',
		' XX~~XXXXXXXXXX ',
		' XXX~XXXXXXXXXX ',
		' XXX~XXXXXXXXX  ',
		' XXXX~XXXXXXXX  ',
		' XXXX~~XXXXXXX  ',
		'  XXX~XXXXXXXX  ',
		'  XXX~XXXXXXXX  ',
		'  XXXX~XXXXXXX  ',
		'  XXXX~XXXXXXX  ',
		'  XXXX~~XXXXXX  ',
		'  XXXXX~XXXXX   ',
		'   XXXX~XXXXX   ',
		'   XXXX~XXXXX   ',
		'   XXXXX~XXXX   ',
		'    XXXX~XXXX   ',
		'    XXXXXXXXX   ',
		'     XXXXXXX    ',
		'      XXXXX     ',
		'       XXX      '
	],
	[
		[0.42, 0.38],
		[0.58, 0.8]
	],
	'src/lib/assets/cards/world-map-portrait.png'
);
