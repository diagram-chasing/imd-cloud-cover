<script lang="ts" module>
	export interface HoverInfo {
		code: string;
		clientX: number;
		clientY: number;
		members: number;
		agg?: { h: number; m: number; l: number; p: number };
	}
</script>

<script lang="ts">
	import { Application, Container, Sprite, Texture, Graphics, Text, type Ticker } from 'pixi.js';
	import type { FeatureCollection } from 'geojson';
	import type { StationsManifest } from '$lib/types';
	import {
		CELL,
		SKY,
		skyMode,
		coverTier,
		rainTier,
		UI,
		SHADOW_TINT,
		SHADOW_ALPHA,
		WAVE,
		type BandKey
	} from '$lib/theme';
	import { buildGeo, loadGroundMask, type Geo } from '$lib/map/geo';
	import groundDayUrl from '$lib/assets/ground/ground-day.png';
	import groundNightUrl from '$lib/assets/ground/ground-night.png';
	import groundMaskUrl from '$lib/assets/ground/ground-mask.png';
	import { buildMarkAtlas, buildRainAtlas, MARK_VARIANTS } from '$lib/map/sprites';
	import { buildQuadtree, nearest, type StationPoint } from '$lib/map/hit';
	import { fnv1a, jitter, mulberry32 } from '$lib/map/hash';
	import { sky } from '$lib/state/sky.svelte';
	import { click, tap } from '$lib/feedback';

	interface Props {
		india: FeatureCollection;
		places?: FeatureCollection;
		manifest: StationsManifest;
		values: Record<string, { h: number; m: number; l: number; p: number }>;
		enableTooltip?: boolean;
		date?: string;
		onhover?: (info: HoverInfo | null) => void;
		onselect?: (code: string, at?: { x: number; y: number }) => void;
		onlayout?: (info: { gutter: number; zoomRatio: number }) => void;
	}
	let {
		india,
		places,
		manifest,
		values,
		date,
		enableTooltip = true,
		onhover,
		onselect,
		onlayout
	}: Props = $props();

	const WORLD_W = 1024;
	const PAD = 4;
	const MARK_CELL = 3;
	const TOWER_GAP = MARK_CELL * 3.5;
	const BIN0 = 24;
	const LODS: { bin: number | null; enter: number }[] = [
		{ bin: BIN0, enter: 0 },
		{ bin: 16, enter: 1.7 },
		{ bin: 11, enter: 2.9 },
		{ bin: null, enter: 4.6 }
	];
	const LOD_DOWN_FACTOR = 0.9;
	const GHOST_ALPHA = 0.1;
	const LABEL_ZOOM = 4.5;
	const BAND_OFFSET: Record<BandKey, number> = {
		high: -TOWER_GAP,
		middle: 0,
		low: TOWER_GAP
	};
	const BAND_KEYS: BandKey[] = ['low', 'middle', 'high'];
	const VAL_KEY: Record<BandKey, 'h' | 'm' | 'l'> = { high: 'h', middle: 'm', low: 'l' };
	const RAIN_DROP = TOWER_GAP + MARK_CELL * 1.5;
	const SHADOW_DROP = RAIN_DROP + MARK_CELL;
	const WAVE_SCALE = 1.25;
	const WAVE_MAX = 100;
	const PLANE_COUNT = 5;
	const TRAIL_LEN = 44;
	const PLANE_SPEED_MIN = 1024 / 90000;
	const PLANE_SPEED_MAX = 1024 / 60000;
	const HUBS: Record<string, [number, number]> = {
		DXB: [55.36, 25.25],
		DOH: [51.61, 25.27],
		KHI: [67.16, 24.91], // west
		DEL: [77.1, 28.56],
		KTM: [85.36, 27.7],
		BOM: [72.87, 19.09], // north / central
		CCU: [88.45, 22.65],
		DAC: [90.4, 23.84],
		MAA: [80.17, 12.99],
		CMB: [79.88, 7.18],
		MLE: [73.53, 4.19], // south
		SIN: [103.99, 1.36],
		KUL: [101.71, 2.75],
		BKK: [100.75, 13.69],
		RGN: [96.13, 16.9] // SE Asia
	};
	const ROUTES: [string, string][] = [
		['DXB', 'BKK'],
		['DXB', 'SIN'],
		['DXB', 'CCU'],
		['DXB', 'KUL'],
		['DXB', 'MAA'],
		['DOH', 'SIN'],
		['DOH', 'DAC'],
		['DOH', 'BKK'],
		['KHI', 'BKK'],
		['KHI', 'CCU'],
		['KHI', 'RGN'],
		['DEL', 'CMB'],
		['DEL', 'MAA'],
		['DEL', 'MLE'],
		['DEL', 'SIN'],
		['DEL', 'KUL'],
		['KTM', 'MLE'],
		['BOM', 'CCU'],
		['BOM', 'DAC'],
		['CCU', 'MLE']
	];

	interface Bin {
		px: number;
		py: number;
		members: number[];
		code: string;
		variant: number;
	}
	interface Lod {
		bin: number;
		scale: number;
		bins: Bin[];
		points: StationPoint[];
	}

	let host = $state<HTMLDivElement>();
	let vw = $state(1);
	let vh = $state(1);

	const STORY_KICKER = "WITH IMD'S METEOGRAMS";
	const STORY_TITLE = 'READING THE CLOUDS';
	const STORY_SUB = "A daily map of India's clouds";
	const MONTHS = [
		'JAN',
		'FEB',
		'MAR',
		'APR',
		'MAY',
		'JUN',
		'JUL',
		'AUG',
		'SEP',
		'OCT',
		'NOV',
		'DEC'
	];
	const HOUR_LABELS = ['00', '03', '06', '09', '12', '15', '18', '21'];

	function prettyDate(iso?: string): string {
		if (!iso) return '';
		const [y, m, d] = iso.split('-').map(Number);
		if (!y || !m || !d) return iso;
		return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
	}

	let app: Application | null = null;
	let geo: Geo | null = null;
	let camera: Container | null = null;
	let groundSprite: Sprite | null = null;
	let groundTex: { day: Texture; night: Texture } | null = null;
	let skyGfx: Graphics | null = null;

	let titleGroup: Container | null = null;
	let titleBox: Graphics | null = null;
	let titleKicker: Text | null = null;
	let titleText: Text | null = null;
	let titleSub: Text | null = null;
	let titleMeta: Text | null = null;

	let titleCx = 0;
	let titleMetaY = 0;
	let titleMetaAlignRight = false;
	let titleMetaRight = 0;
	let titleShown = false;
	let hoverGfx: Graphics | null = null;
	let selGfx: Graphics | null = null;
	let placesLayer: Container | null = null;
	let placeMarkers: Container[] = [];
	let placeLabels: Text[] = [];
	let placeDots: Graphics[] = [];
	let placePlates: Graphics[] = [];
	let bins: Bin[] = [];
	let binByCode = new Map<string, Bin>();
	let lods: Lod[] = [];
	let lodIndex = -1;
	let maxBins = 0;
	let planeLayer: Container | null = null;
	interface Plane {
		c: Container;
		ox: number;
		oy: number;
		ux: number;
		uy: number;
		s: number;
		sStart: number;
		sTarget: number;
		sDir: 1 | -1;
		speed: number;
		heading: number;
	}
	let planes: Plane[] = [];
	let planeRand: (() => number) | null = null;
	let hubXY: Record<string, [number, number]> = {};
	let planeTex: Texture | null = null;
	let trailTex: Texture | null = null;
	const pool: Record<BandKey, Sprite[]> = { low: [], middle: [], high: [] };
	let layers: Record<BandKey, Container> | null = null;
	const alphaTarget: Record<BandKey, number> = { low: 1, middle: 1, high: 1 };
	let cloudTex: Record<BandKey, Texture[][]> = { low: [], middle: [], high: [] };
	let rainPool: Sprite[] = [];
	let rainTex: Texture[][] = [];
	let shadowLayer: Container | null = null;
	let shadowPool: Sprite[] = [];
	let waveLayer: Container | null = null;
	let waveTex: Texture[] = [];
	let waves: { s: Sprite; phase: number }[] = [];
	let quad: ReturnType<typeof buildQuadtree> | null = null;

	let zoom = 1;
	let panX = 0;
	let panY = 0;
	let userMoved = false;

	function worldBBox() {
		const g = geo!;
		return { minX: -PAD, maxX: g.worldW + PAD, minY: -PAD, maxY: g.worldH + PAD };
	}
	function containZoom() {
		const b = worldBBox();
		return Math.min(vw / (b.maxX - b.minX), vh / (b.maxY - b.minY));
	}
	function narrowLayout() {
		const b = worldBBox();
		return (vw / containZoom() - (b.maxX - b.minX)) / 2 < 90;
	}
	function startZoomFactor() {
		return narrowLayout() ? 1.7 : 1;
	}
	function startView() {
		const b = worldBBox();
		const z = containZoom() * startZoomFactor();
		const w = vw / z;
		const h = vh / z;
		return {
			x: (b.minX + b.maxX) / 2 - w / 2,
			y: (b.minY + b.maxY) / 2 - h / 2,
			w,
			h
		};
	}
	function fitCamera() {
		if (!geo) return;
		const v = startView();
		zoom = containZoom() * startZoomFactor();
		panX = v.x;
		panY = v.y;
		applyCamera();
	}
	function applyCamera() {
		if (!camera) return;
		camera.scale.set(zoom);
		camera.position.set(-panX * zoom, -panY * zoom);
		if (lods.length) applyLod(lodForZoom());
		updatePlacesScale();
		updateLabelVis();
		updateTitleFade();
		emitLayout();
	}

	function emitLayout() {
		if (!geo) return;
		const b = worldBBox();
		onlayout?.({
			gutter: (vw - (b.maxX - b.minX) * containZoom()) / 2,
			zoomRatio: zoom / containZoom()
		});
	}

	function updatePlacesScale() {
		if (!placeMarkers.length) return;
		const s = 1 / zoom;
		for (const m of placeMarkers) m.scale.set(s);
	}

	function updateLabelVis() {
		if (!placesLayer) return;
		placesLayer.visible = zoom >= containZoom() * LABEL_ZOOM;
	}

	function mkTex(canvas: HTMLCanvasElement | OffscreenCanvas): Texture {
		const t = Texture.from(canvas as HTMLCanvasElement);
		t.source.scaleMode = 'nearest';
		return t;
	}

	function loadTex(url: string): Promise<Texture> {
		return new Promise((res, rej) => {
			const im = new Image();
			im.onload = () => {
				const t = Texture.from(im);
				t.source.scaleMode = 'nearest';
				res(t);
			};
			im.onerror = rej;
			im.src = url;
		});
	}

	function buildBins(binSize: number | null): Bin[] {
		const g = geo!;
		if (binSize === null) {
			return g.stations
				.map((st, i) => ({
					px: st.rpx + jitter(st.code, 'jx', 3) + jitter(st.code, 'sx', 2),
					py: st.rpy + jitter(st.code, 'jy', 2) + jitter(st.code, 'sy', 2),
					members: [i],
					code: st.code,
					variant: fnv1a(st.code) % MARK_VARIANTS
				}))
				.sort((a, b) => a.py - b.py);
		}
		const map = new Map<string, Bin>();
		g.stations.forEach((st, i) => {
			const bx = Math.floor(st.rpx / binSize);
			const by = Math.floor(st.rpy / binSize);
			const key = `${bx},${by}`;
			let b = map.get(key);
			if (!b) {
				b = {
					px: (bx + 0.5) * binSize,
					py: (by + 0.5) * binSize,
					members: [],
					code: st.code,
					variant: 0
				};
				map.set(key, b);
			}
			b.members.push(i);
		});
		for (const b of map.values()) {
			let best = Infinity;
			for (const i of b.members) {
				const st = g.stations[i];
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
		return [...map.values()].sort((a, b) => a.py - b.py);
	}

	function buildLods() {
		lods = LODS.map(({ bin }) => {
			const resolved = bin ?? 9;
			const built = buildBins(bin);
			return {
				bin: resolved,
				scale: resolved / BIN0,
				bins: built,
				points: built.map((b) => ({
					code: b.code,
					cellX: 0,
					cellY: 0,
					x: b.px,
					y: b.py,
					members: b.members.length
				}))
			};
		});
		maxBins = Math.max(...lods.map((l) => l.bins.length));
	}

	function hitR(): number {
		return (lodIndex < 0 ? BIN0 : lods[lodIndex].bin) * 0.7;
	}

	function lodForZoom(): number {
		const r = zoom / containZoom();
		let L = 0;
		for (let i = 1; i < LODS.length; i++) if (r >= LODS[i].enter) L = i;
		if (L < lodIndex && r > LODS[lodIndex].enter * LOD_DOWN_FACTOR) L = lodIndex;
		return L;
	}

	function applyLod(i: number) {
		if (i === lodIndex || !layers) return;
		lodIndex = i;
		const lod = lods[i];
		bins = lod.bins;
		binByCode = new Map(bins.map((b) => [b.code, b]));
		const sc = lod.scale;
		for (const band of BAND_KEYS) {
			const off = BAND_OFFSET[band] * sc;
			const arr = pool[band];
			for (let k = 0; k < bins.length; k++) {
				const sp = arr[k];
				sp.x = bins[k].px;
				sp.y = bins[k].py + off;
				sp.scale.set(sc);
			}
			for (let k = bins.length; k < arr.length; k++) arr[k].visible = false;
		}
		const rainOff = RAIN_DROP * sc;
		for (let k = 0; k < bins.length; k++) {
			const sp = rainPool[k];
			sp.x = bins[k].px;
			sp.y = bins[k].py + rainOff;
			sp.scale.set(sc);
		}
		for (let k = bins.length; k < rainPool.length; k++) rainPool[k].visible = false;
		// Shadows fall at the foot of the tower, nudged right and squashed flat
		// to read as a patch on the ground plane.
		const shadowOff = SHADOW_DROP * sc;
		for (let k = 0; k < bins.length; k++) {
			const sp = shadowPool[k];
			sp.x = bins[k].px + 2 * sc;
			sp.y = bins[k].py + shadowOff;
			sp.scale.set(sc, sc * 0.55);
		}
		for (let k = bins.length; k < shadowPool.length; k++) shadowPool[k].visible = false;
		quad = buildQuadtree(lod.points);
		updateClouds();
		updateRain();
		drawSelected();
		drawHover();
	}

	async function init() {
		if (!host) return;
		await document.fonts.load("10px 'Ships Whistle'").catch(() => {});
		const atlas = buildMarkAtlas(MARK_CELL);
		const rainAtlas = buildRainAtlas(MARK_CELL);
		const [mask, dayTex, nightTex] = await Promise.all([
			loadGroundMask(groundMaskUrl).catch(() => undefined),
			loadTex(groundDayUrl),
			loadTex(groundNightUrl)
		]);
		groundTex = { day: dayTex, night: nightTex };
		geo = buildGeo(india, manifest, WORLD_W, CELL, places, mask);
		buildLods();

		app = new Application();
		await app.init({
			resizeTo: host,
			antialias: false,
			backgroundAlpha: 0,
			resolution: window.devicePixelRatio || 1,
			autoDensity: true
		});
		if (!host) {
			app.destroy();
			return;
		}
		host.appendChild(app.canvas);
		app.canvas.style.cursor = 'grab';

		skyGfx = new Graphics();
		app.stage.addChild(skyGfx);

		camera = new Container();
		app.stage.addChild(camera);

		groundSprite = new Sprite(groundTex[skyMode(sky.timeIndex)]);
		groundSprite.scale.set(geo.groundScale);
		camera.addChild(groundSprite);

		// Cloud shadows sit directly on the ground, under every other layer.
		shadowLayer = new Container();
		shadowLayer.eventMode = 'none';
		camera.addChild(shadowLayer);

		buildWaves();

		const titleFont = {
			fontFamily: "'Ships Whistle', monospace",
			fill: 0xffffff,
			align: 'left' as const
		};
		titleGroup = new Container();
		titleGroup.eventMode = 'none';
		titleBox = new Graphics();
		titleKicker = new Text({ text: STORY_KICKER, style: { ...titleFont, fontWeight: '400' } });
		titleText = new Text({ text: STORY_TITLE, style: { ...titleFont, fontWeight: '700' } });
		titleSub = new Text({ text: STORY_SUB, style: { ...titleFont, fontWeight: '400' } });
		titleMeta = new Text({ text: '', style: { ...titleFont, fontWeight: '700' } });
		titleGroup.addChild(titleBox, titleKicker, titleText, titleSub, titleMeta);
		camera.addChild(titleGroup);

		buildPlaces();

		cloudTex = { low: [], middle: [], high: [] };
		for (const band of BAND_KEYS) {
			for (let tier = 1; tier <= 4; tier++) {
				cloudTex[band][tier] = [];
				for (let v = 0; v < MARK_VARIANTS; v++) {
					cloudTex[band][tier][v] = mkTex(atlas.get(band, tier as 1 | 2 | 3 | 4, v).canvas);
				}
			}
		}
		rainTex = [];
		for (let tier = 1; tier <= 3; tier++) {
			rainTex[tier] = [];
			for (let v = 0; v < MARK_VARIANTS; v++) {
				rainTex[tier][v] = mkTex(rainAtlas.get(tier as 1 | 2 | 3, v).canvas);
			}
		}

		shadowPool = Array.from({ length: maxBins }, () => {
			const s = new Sprite(cloudTex.low[1][0]);
			s.anchor.set(0.5, 0.5);
			s.tint = SHADOW_TINT;
			s.visible = false;
			shadowLayer!.addChild(s);
			return s;
		});

		const rainLayer = new Container();
		camera.addChild(rainLayer);
		rainPool = Array.from({ length: maxBins }, () => {
			const s = new Sprite(rainTex[1][0]);
			s.anchor.set(0.5, 0);
			s.visible = false;
			rainLayer.addChild(s);
			return s;
		});

		const layerMap = {} as Record<BandKey, Container>;
		for (const band of BAND_KEYS) {
			const layer = new Container();
			camera.addChild(layer);
			layerMap[band] = layer;
			pool[band] = Array.from({ length: maxBins }, () => {
				const s = new Sprite(cloudTex[band][1][0]);
				s.anchor.set(0.5, 0.5);
				s.visible = false;
				layer.addChild(s);
				return s;
			});
		}
		layers = layerMap;
		retargetAlphas();

		buildPlanes();
		styleAmbient();

		// Place labels ride above the cloud towers so cities stay readable when
		// zoomed in over dense cover.
		if (placesLayer) camera.addChild(placesLayer);

		selGfx = new Graphics();
		camera.addChild(selGfx);
		hoverGfx = new Graphics();
		camera.addChild(hoverGfx);

		fitCamera();
		drawSky();
		drawTitle();
		drawSelected();
		updateClouds();
		bindPointer();
		app.ticker.add(tick);
		requestAnimationFrame(() => {
			if (!userMoved) fitCamera();
		});
	}

	function drawSky() {
		if (!skyGfx) return;
		const pal = SKY[skyMode(sky.timeIndex)];
		skyGfx.clear();
		skyGfx.rect(0, 0, vw, vh).fill({ color: pal.top });
	}

	function drawTitle() {
		if (!titleGroup || !titleBox || !titleKicker || !titleText || !titleSub || !titleMeta || !geo)
			return;
		const b = worldBBox();
		const gutter = (vw / containZoom() - (b.maxX - b.minX)) / 2;
		const narrow = gutter < 90;

		const unit = 30;
		const pad = unit * 0.75; // inner box padding
		const gap = unit * 0.7; // vertical gap between rows

		titleKicker.style.fontSize = unit * 0.64;
		titleKicker.style.letterSpacing = 0;
		titleText.style.fontSize = unit;
		titleText.style.fontWeight = '700';
		titleText.style.letterSpacing = unit * 0.02;
		titleSub.style.fontSize = unit * 0.64;
		const metaFS = narrow ? unit * 0.55 : unit * 0.4;
		titleMeta.style.fontSize = metaFS;
		titleMeta.style.letterSpacing = unit * 0.04;
		for (const t of [titleKicker, titleText, titleSub, titleMeta]) t.style.fill = 0xffffff;

		const boxInnerW = Math.max(titleKicker.width, titleText.width);
		const boxW = boxInnerW + pad * 2;
		const boxH = titleText.height + gap * 0.4 + titleKicker.height + pad * 2;

		const contentW = Math.max(boxW, titleSub.width);
		titleCx = contentW / 2;

		const boxX = narrow ? contentW - boxW : (contentW - boxW) / 2;
		const bcx = boxX + boxW / 2;
		titleText.position.set(bcx - titleText.width / 2, pad);
		titleKicker.position.set(bcx - titleKicker.width / 2, pad + titleText.height + gap * 0.4);

		let y = boxH + gap * 0.9;
		titleSub.position.set(
			narrow ? contentW - titleSub.width - titleSub.width * 0.22 : (contentW - titleSub.width) / 2,
			y
		);
		y += titleSub.height + gap * 0.75;

		titleBox.clear();
		titleBox
			.rect(boxX, 0, boxW, boxH)
			.stroke({ width: Math.max(1, unit * 0.045), color: 0xffffff, alignment: 0 });

		const metaLineH = metaFS * 1.4;
		titleShown = true;
		if (!narrow) {
			const sepW = contentW * 0.42;
			const sepY = y;
			y += gap * 0.9;
			titleBox
				.moveTo(titleCx - sepW / 2, sepY)
				.lineTo(titleCx + sepW / 2, sepY)
				.stroke({ width: Math.max(1, unit * 0.03), color: 0xffffff, alignment: 0.5 });
			titleMetaAlignRight = false;
			titleMetaY = y;
			const groupH = y + metaLineH;
			const s = Math.min((gutter * 0.8) / contentW, (geo.worldH * 0.5) / groupH);
			titleGroup.scale.set(s);
			titleGroup.position.set(
				b.minX - (gutter + contentW * s) / 2,
				geo.worldH / 2 - (groupH * s) / 2
			);
		} else {
			const v = startView();
			const groupH = y;
			const s = Math.min((v.w * 0.49) / contentW, (v.h * 0.16) / groupH);
			const mx = v.w * 0.04;
			titleGroup.scale.set(s);
			titleGroup.position.set(v.x + v.w - contentW * s - mx, v.y + mx);

			titleMetaRight = contentW;
			titleMetaY = (v.y + v.h - mx * 1.5) / s - metaLineH;
		}
		updateTitleMeta();
		updateTitleFade();
	}

	function updateTitleMeta() {
		if (!titleMeta) return;
		const time = sky.view === 'today' ? `As of ${HOUR_LABELS[sky.timeIndex]}:00 IST` : 'DAILY MEAN';
		titleMeta.text = [prettyDate(date), time].filter(Boolean).join('  ·  ');
		titleMeta.position.set(
			titleMetaAlignRight ? titleMetaRight - titleMeta.width : titleCx - titleMeta.width / 2,
			titleMetaY
		);
	}

	function updateTitleFade() {
		if (!titleGroup) return;
		if (!titleShown) {
			titleGroup.visible = false;
			return;
		}
		const zr = zoom / (containZoom() * startZoomFactor());
		const fade = Math.max(0, Math.min(1, (1.55 - zr) / (1.55 - 1.05)));
		const night = skyMode(sky.timeIndex) === 'night';
		titleGroup.alpha = (night ? 0.72 : 0.6) * fade;
		titleGroup.visible = fade > 0.01;
	}

	function placeSize(pop: number): number {
		if (pop >= 8_000_000) return 20;
		if (pop >= 3_000_000) return 16;
		return 14;
	}

	function buildPlaces() {
		if (!geo || !camera) return;
		placesLayer = new Container();
		placesLayer.eventMode = 'none';
		camera.addChild(placesLayer);
		placeMarkers = [];
		placeLabels = [];
		placeDots = [];
		placePlates = [];
		const GAP = 5;

		for (const p of geo.places) {
			const m = new Container();
			m.eventMode = 'none';
			m.position.set(p.px, p.py);

			const dot = new Graphics();
			dot.rect(-1.5, -1.5, 3, 3).fill({ color: 0xffffff });
			m.addChild(dot);
			placeDots.push(dot);

			const label = new Text({
				text: p.name.toUpperCase(),
				style: {
					fontFamily: "'Ships Whistle', monospace",
					fontWeight: '400',
					fontSize: placeSize(p.pop),
					fill: 0xffffff,
					letterSpacing: 0.5
				},
				resolution: 4
			});
			label.anchor.set(0, 0.5);
			label.position.set(GAP, 0);

			const padX = 2.5;
			const padY = 1.5;
			const plate = new Graphics();
			plate
				.rect(GAP - padX, -label.height / 2 - padY, label.width + padX * 2, label.height + padY * 2)
				.fill({ color: 0xffffff });
			m.addChild(plate);
			placePlates.push(plate);

			m.addChild(label);
			placeLabels.push(label);

			placesLayer.addChild(m);
			placeMarkers.push(m);
		}
		updatePlacesScale();
		stylePlaces();
	}

	function stylePlaces() {
		const night = skyMode(sky.timeIndex) === 'night';
		const ink = night ? 0xeaf4ff : 0x0a1a28;
		const plate = night ? 0x0a1a2e : 0xf7faf6;
		const plateAlpha = night ? 0.66 : 0.82;
		for (const d of placeDots) {
			d.tint = ink;
			d.alpha = 1;
		}
		for (const pl of placePlates) {
			pl.tint = plate;
			pl.alpha = plateAlpha;
		}
		for (const t of placeLabels) {
			t.style.fill = ink;
			t.alpha = 1;
		}
	}

	function makeCanvas(w: number, h: number): HTMLCanvasElement {
		const c = document.createElement('canvas');
		c.width = w;
		c.height = h;
		return c;
	}

	const PLANE_ROWS: number[][] = [
		[4, 5, 6], // y0  wingtip (top)
		[5, 6, 7], // y1  wing
		[1, 6, 7, 8], // y2  tail nub + wing root
		[1, 2, 4, 5, 6, 7, 8, 9, 10], // y3  tailplane + body
		[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], // y4  fuselage spine → nose
		[1, 2, 4, 5, 6, 7, 8, 9, 10], // y5  tailplane + body
		[1, 6, 7, 8], // y6  tail nub + wing root
		[5, 6, 7], // y7  wing
		[4, 5, 6] // y8  wingtip (bottom)
	];
	const PLANE_W = 13;
	function buildPlaneTex(): Texture {
		const px = 1;
		const c = makeCanvas(PLANE_W * px, PLANE_ROWS.length * px);
		const ctx = c.getContext('2d')!;
		ctx.imageSmoothingEnabled = false;
		ctx.fillStyle = '#ffffff';
		PLANE_ROWS.forEach((xs, y) => {
			for (const x of xs) ctx.fillRect(x * px, y * px, px, px);
		});
		return mkTex(c);
	}

	function buildTrailTex(len: number): Texture {
		const c = makeCanvas(len, 1);
		const ctx = c.getContext('2d')!;
		const grad = ctx.createLinearGradient(0, 0, len, 0);
		grad.addColorStop(0, 'rgba(255,255,255,0)');
		grad.addColorStop(1, 'rgba(255,255,255,0.5)');
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, len, 1);
		return mkTex(c);
	}

	// A tiny pixel wave crest — a "~" tilde that rises then dips. The two frames
	// shift the crest sideways by one pixel so the ripple appears to roll across
	// the water when the drift timer flips frames, instead of seesawing in place.
	const WAVE_CURVE = [1, 0, 0, 1, 2, 2, 1, 1]; // crest-line row per column
	function buildWaveTex(): Texture[] {
		const W = WAVE_CURVE.length;
		return [0, 1].map((shift) => {
			const c = makeCanvas(W, 3);
			const ctx = c.getContext('2d')!;
			ctx.fillStyle = '#ffffff';
			for (let x = 0; x < W; x++) ctx.fillRect(x, WAVE_CURVE[(x + shift) % W], 1, 1);
			return mkTex(c);
		});
	}

	function buildWaves() {
		if (!geo || !camera) return;
		waveTex = buildWaveTex();
		waveLayer = new Container();
		waveLayer.eventMode = 'none';
		camera.addChild(waveLayer);
		waves = [];
		const g = geo;
		const gc = g.groundScale;
		const r = mulberry32(fnv1a('waves'));
		// Scatter well past the ground raster on both sides so the open sea reaches
		// into the gutters and fills the full viewport width, not just the map box.
		const marginX = Math.round(g.cols * 0.7);
		// First collect every open-sea cell in the southern band, then sample the
		// wanted count uniformly from that whole pool — filling top-down and
		// stopping at the cap left them bunched in a narrow band up high.
		const cand: { x: number; y: number }[] = [];
		for (let y = Math.ceil(g.rows * 0.5); y < g.rows; y++) {
			for (let x = -marginX; x < g.cols + marginX; x++) {
				// Land/shallow only exist inside the raster; anything outside is open sea.
				if (x >= 0 && x < g.cols) {
					const idx = y * g.cols + x;
					if (g.land[idx] || g.shallow[idx]) continue;
				}
				// Slightly denser over the big open sea south of the peninsula.
				const p = 0.0022 * (y > g.rows * 0.62 ? 1.7 : 1);
				if (r() < p) cand.push({ x, y });
			}
		}
		// Fisher-Yates shuffle so the cap trims evenly, not from the bottom.
		for (let i = cand.length - 1; i > 0; i--) {
			const j = Math.floor(r() * (i + 1));
			[cand[i], cand[j]] = [cand[j], cand[i]];
		}
		for (const { x, y } of cand.slice(0, WAVE_MAX)) {
			const s = new Sprite(waveTex[r() < 0.5 ? 0 : 1]);
			s.anchor.set(0.5, 0.5);
			s.scale.set(WAVE_SCALE);
			s.position.set((x + 0.5) * gc + (r() * 4 - 2), (y + 0.5) * gc + (r() * 4 - 2));
			waveLayer.addChild(s);
			waves.push({ s, phase: Math.floor(r() * 4) });
		}
	}

	function buildPlanes() {
		if (!geo || !camera) return;
		planeTex = buildPlaneTex();
		trailTex = buildTrailTex(TRAIL_LEN);
		planeLayer = new Container();
		planeLayer.eventMode = 'none';
		camera.addChild(planeLayer);
		planes = [];
		planeRand = mulberry32(fnv1a('planes'));
		hubXY = {};
		for (const [name, ll] of Object.entries(HUBS)) {
			const w = geo.project(ll[0], ll[1]);
			if (w) hubXY[name] = w;
		}
		for (let i = 0; i < PLANE_COUNT; i++) {
			const trail = new Sprite(trailTex);
			trail.anchor.set(1, 0.5);
			trail.x = -(PLANE_W - 2);
			const body = new Sprite(planeTex);
			body.anchor.set(1, 0.5);
			const c = new Container();
			c.eventMode = 'none';
			c.addChild(trail);
			c.addChild(body);
			planeLayer.addChild(c);
			const p: Plane = {
				c,
				ox: 0,
				oy: 0,
				ux: 1,
				uy: 0,
				s: 0,
				sStart: 0,
				sTarget: 0,
				sDir: 1,
				speed: 0,
				heading: 0
			};
			resetPlane(p, !reduced);
			planes.push(p);
		}
	}

	function rectClipLine(
		ox: number,
		oy: number,
		ux: number,
		uy: number,
		minX: number,
		minY: number,
		maxX: number,
		maxY: number
	): [number, number] | null {
		let sMin = -Infinity;
		let sMax = Infinity;
		for (const [o, u, lo, hi] of [
			[ox, ux, minX, maxX],
			[oy, uy, minY, maxY]
		] as const) {
			if (u === 0) {
				if (o < lo || o > hi) return null; // parallel and outside the slab
			} else {
				let a = (lo - o) / u;
				let b = (hi - o) / u;
				if (a > b) [a, b] = [b, a];
				if (a > sMin) sMin = a;
				if (b < sMax) sMax = b;
			}
		}
		return sMin < sMax ? [sMin, sMax] : null;
	}

	function resetPlane(p: Plane, initial = false) {
		if (!geo || !planeRand) return;
		const r = planeRand;
		const g = geo;
		const M = TRAIL_LEN * 2; // how far off-screen the ends live
		// Let flight paths run well past the map box horizontally so planes cross
		// the gutters and span the full viewport width, not just over India.
		const EX = g.worldW * 0.7;
		let clip: [number, number] | null = null;
		let ax = 0,
			ay = 0,
			ux = 0,
			uy = 0;
		for (let tries = 0; tries < 12 && !clip; tries++) {
			const route = ROUTES[Math.floor(r() * ROUTES.length)];
			const a = hubXY[route[0]];
			const b = hubXY[route[1]];
			if (!a || !b) continue;
			let dx = b[0] - a[0];
			let dy = b[1] - a[1];
			const len = Math.hypot(dx, dy);
			if (len < 1) continue;
			dx /= len;
			dy /= len;
			ax = a[0];
			ay = a[1];
			ux = dx;
			uy = dy;
			clip = rectClipLine(ax, ay, ux, uy, -EX, -M, g.worldW + EX, g.worldH + M);
		}
		if (!clip) return;
		let [start, end] = clip;
		if (r() < 0.5) [start, end] = [end, start];
		p.ox = ax;
		p.oy = ay;
		p.ux = ux;
		p.uy = uy;
		p.sStart = start;
		p.sTarget = end;
		p.sDir = end >= start ? 1 : -1;
		p.speed = PLANE_SPEED_MIN + r() * (PLANE_SPEED_MAX - PLANE_SPEED_MIN);
		p.heading = Math.atan2(uy * p.sDir, ux * p.sDir);
		p.s = initial ? start + (end - start) * r() : start;
		p.c.x = p.ox + p.s * p.ux;
		p.c.y = p.oy + p.s * p.uy;
		p.c.rotation = p.heading;
		p.c.alpha = planeAlpha(p);
	}

	function planeAlpha(p: Plane): number {
		const span = p.sTarget - p.sStart;
		if (!span) return 0;
		const f = (p.s - p.sStart) / span; // 0 at entry → 1 at exit
		const FADE = 0.14;
		return Math.max(0, Math.min(1, Math.min(f, 1 - f) / FADE));
	}

	function styleAmbient() {
		const mode = skyMode(sky.timeIndex);
		const night = mode === 'night';
		const trailTint = night ? 0xcfe4ff : 0xffffff;
		for (const p of planes) {
			const [trail, body] = p.c.children as Sprite[];
			trail.tint = trailTint;
			body.tint = trailTint;
		}
		if (shadowLayer) shadowLayer.alpha = SHADOW_ALPHA[mode];
		const wavePal = WAVE[mode];
		for (const w of waves) {
			w.s.tint = wavePal.color;
			w.s.alpha = wavePal.alpha;
		}
	}

	function updateGround() {
		if (!groundSprite || !groundTex) return;
		groundSprite.texture = groundTex[skyMode(sky.timeIndex)];
	}

	function binCover(b: Bin, key: 'h' | 'm' | 'l' | 'p'): number {
		let s = 0;
		let n = 0;
		for (const i of b.members) {
			const v = values[geo!.stations[i].code];
			if (v) {
				s += v[key];
				n++;
			}
		}
		return n ? s / n : 0;
	}

	function hoverInfo(code: string, clientX: number, clientY: number): HoverInfo {
		const b = binByCode.get(code);
		const members = b?.members.length ?? 1;
		return {
			code,
			clientX,
			clientY,
			members,
			agg:
				b && members > 1
					? {
							h: Math.round(binCover(b, 'h')),
							m: Math.round(binCover(b, 'm')),
							l: Math.round(binCover(b, 'l')),
							p: Math.round(binCover(b, 'p'))
						}
					: undefined
		};
	}

	let driftTick = 0;
	function updateClouds() {
		if (!geo || !layers) return;
		for (const band of BAND_KEYS) {
			const key = VAL_KEY[band];
			for (let i = 0; i < bins.length; i++) {
				const sp = pool[band][i];
				const tier = coverTier(binCover(bins[i], key));
				if (tier === 0) {
					sp.visible = false;
					continue;
				}
				sp.visible = true;
				sp.texture = cloudTex[band][tier][bins[i].variant];
			}
		}
		// Ground shadow per bin: driven by effective cover across the tower, with
		// higher bands contributing less (thin cirrus casts almost nothing).
		for (let i = 0; i < bins.length; i++) {
			const sp = shadowPool[i];
			if (!sp) break;
			const eff = Math.max(
				binCover(bins[i], 'l'),
				binCover(bins[i], 'm') * 0.8,
				binCover(bins[i], 'h') * 0.45
			);
			const tier = coverTier(eff);
			if (tier === 0) {
				sp.visible = false;
				continue;
			}
			sp.visible = true;
			sp.texture = cloudTex.low[tier][bins[i].variant];
		}
	}

	function updateRain() {
		if (!geo || !layers) return;
		for (let i = 0; i < bins.length; i++) {
			const sp = rainPool[i];
			const tier = rainTier(binCover(bins[i], 'p'));
			if (tier === 0) {
				sp.visible = false;
				continue;
			}
			sp.visible = true;
			sp.texture = rainTex[tier][bins[i].variant];
		}
	}

	function retargetAlphas() {
		for (const band of BAND_KEYS)
			alphaTarget[band] = sky.focusBand === null || sky.focusBand === band ? 1 : GHOST_ALPHA;
	}

	function towerBox(b: Bin): { x: number; y: number; w: number; h: number } | null {
		if (lodIndex < 0) return null;
		const lod = lods[lodIndex];
		const sc = lod.scale;
		const halfW = lod.bin * 0.6;
		return {
			x: b.px - halfW,
			y: b.py - (TOWER_GAP + 4) * sc,
			w: halfW * 2,
			h: (TOWER_GAP * 2 + 24) * sc
		};
	}

	function drawHover() {
		if (!hoverGfx || !geo) return;
		hoverGfx.clear();
		const code = sky.hoverCode;
		if (!code) return;
		const b = bins.find((x) => x.code === code);
		if (!b) return;
		const box = towerBox(b);
		if (!box) return;
		const night = skyMode(sky.timeIndex) === 'night';
		hoverGfx
			.rect(box.x, box.y, box.w, box.h)
			.stroke({ width: 2, color: night ? UI.focus : 0xffffff, alignment: 0.5 });
	}

	function drawSelected() {
		if (!selGfx || !geo) return;
		selGfx.clear();
		const code = sky.selectedCode;
		if (!code) return;
		const b = bins.find((x) => x.code === code);
		if (!b) return;
		const box = towerBox(b);
		if (!box) return;
		selGfx
			.rect(box.x, box.y, box.w, box.h)
			.fill({ color: UI.focus, alpha: 0.12 })
			.stroke({ width: 2, color: UI.focus, alignment: 0.5 });
	}

	let lastDrift = 0;
	let reduced = false;
	function tick(t: Ticker) {
		if (layers) {
			for (const band of BAND_KEYS) {
				const layer = layers[band];
				const target = alphaTarget[band];
				if (reduced || Math.abs(layer.alpha - target) < 0.004) layer.alpha = target;
				else layer.alpha += (target - layer.alpha) * Math.min(1, t.deltaMS / 90);
			}
		}
		if (reduced || sky.view !== 'today') return;
		const now = performance.now();
		if (now - lastDrift > 1200) {
			lastDrift = now;
			driftTick = (driftTick + 1) % 4;
			if (layers) layers.high.x = driftTick * 2 * (lodIndex < 0 ? 1 : lods[lodIndex].scale);
			for (const w of waves) w.s.texture = waveTex[(driftTick + w.phase) & 1];
		}
		for (const p of planes) {
			p.s += p.sDir * p.speed * t.deltaMS;
			p.c.x = p.ox + p.s * p.ux;
			p.c.y = p.oy + p.s * p.uy;
			p.c.alpha = planeAlpha(p);
			if ((p.sDir > 0 && p.s >= p.sTarget) || (p.sDir < 0 && p.s <= p.sTarget)) resetPlane(p);
		}
	}

	function clientToWorld(clientX: number, clientY: number) {
		const rect = app!.canvas.getBoundingClientRect();
		return { ox: panX + (clientX - rect.left) / zoom, oy: panY + (clientY - rect.top) / zoom };
	}
	let dragging = false;
	let moved = false;
	let last = { x: 0, y: 0 };
	function bindPointer() {
		const c = app!.canvas;
		c.addEventListener('pointerdown', (e) => {
			dragging = true;
			moved = false;
			userMoved = true;
			last = { x: e.clientX, y: e.clientY };
			c.setPointerCapture(e.pointerId);
		});
		c.addEventListener('pointermove', (e) => {
			if (dragging) {
				if (Math.abs(e.clientX - last.x) + Math.abs(e.clientY - last.y) > 3) moved = true;
				panX -= (e.clientX - last.x) / zoom;
				panY -= (e.clientY - last.y) / zoom;
				last = { x: e.clientX, y: e.clientY };
				clampPan();
				applyCamera();
				if (moved && sky.selectedCode) sky.selectedCode = null;
				if (enableTooltip && sky.hoverCode)
					onhover?.(hoverInfo(sky.hoverCode, e.clientX, e.clientY));
				return;
			}
			const { ox, oy } = clientToWorld(e.clientX, e.clientY);
			const p = quad ? nearest(quad, ox, oy, hitR()) : null;
			sky.hoverCode = p ? p.code : null;
			drawHover();
			if (enableTooltip) onhover?.(p ? hoverInfo(p.code, e.clientX, e.clientY) : null);
		});
		c.addEventListener('pointerup', (e) => {
			if (dragging && !moved) {
				const { ox, oy } = clientToWorld(e.clientX, e.clientY);
				const p = quad ? nearest(quad, ox, oy, hitR()) : null;
				if (p) {
					sky.selectedCode = p.code;
					// Fire with the selection box appearing: firmer click + a light tap.
					click('select');
					tap('light');
					const rect = app!.canvas.getBoundingClientRect();
					onselect?.(p.code, {
						x: rect.left + (p.x - panX) * zoom,
						y: rect.top + (p.y - panY) * zoom
					});
				}
			}
			dragging = false;
		});
		c.addEventListener('pointerleave', () => {
			sky.hoverCode = null;
			drawHover();
			onhover?.(null);
		});
		c.addEventListener(
			'wheel',
			(e) => {
				e.preventDefault();
				userMoved = true;
				zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
			},
			{ passive: false }
		);
	}
	function zoomAt(clientX: number, clientY: number, factor: number) {
		const rect = app!.canvas.getBoundingClientRect();
		const sx = clientX - rect.left;
		const sy = clientY - rect.top;
		const ox = panX + sx / zoom;
		const oy = panY + sy / zoom;
		const fit = containZoom();
		zoom = Math.max(fit * 0.9, Math.min(fit * 7, zoom * factor));
		panX = ox - sx / zoom;
		panY = oy - sy / zoom;
		clampPan();
		applyCamera();
		if (sky.selectedCode) sky.selectedCode = null;
	}
	function clampPan() {
		const b = worldBBox();
		const slack = 100;
		const ax = (min: number, size: number, viewWorld: number, v: number) => {
			if (viewWorld >= size) {
				const c = min - (viewWorld - size) / 2;
				return Math.min(c + slack, Math.max(c - slack, v));
			}
			return Math.min(min + size - viewWorld + slack, Math.max(min - slack, v));
		};
		panX = ax(b.minX, b.maxX - b.minX, vw / zoom, panX);
		panY = ax(b.minY, b.maxY - b.minY, vh / zoom, panY);
	}
	function zoomButton(dir: 1 | -1) {
		userMoved = true;
		const rect = app?.canvas.getBoundingClientRect();
		zoomAt((rect?.left ?? 0) + vw / 2, (rect?.top ?? 0) + vh / 2, dir > 0 ? 1.3 : 1 / 1.3);
	}
	export function zoomIn() {
		zoomButton(1);
	}
	export function zoomOut() {
		zoomButton(-1);
	}
	export function zoomReset() {
		userMoved = false;
		fitCamera();
	}

	$effect(() => {
		if (!host) return;
		const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
		reduced = mq.matches;
		const onmq = () => (reduced = mq.matches);
		mq.addEventListener('change', onmq);
		const ro = new ResizeObserver((entries) => {
			const r = entries[0].contentRect;
			vw = Math.round(r.width);
			vh = Math.round(r.height);
			drawSky();
			drawTitle();
			if (!userMoved) fitCamera();
			else emitLayout();
		});
		ro.observe(host);
		init();
		return () => {
			mq.removeEventListener('change', onmq);
			ro.disconnect();
			app?.destroy(true);
			app = null;
		};
	});

	$effect(() => {
		void values;
		if (app) {
			updateClouds();
			updateRain();
		}
	});
	$effect(() => {
		void sky.focusBand;
		retargetAlphas();
	});
	$effect(() => {
		void sky.timeIndex;
		if (app) {
			updateGround();
			drawSky();
			updateTitleMeta();
			updateTitleFade();
			stylePlaces();
			styleAmbient();
			drawHover();
		}
	});
	$effect(() => {
		void sky.view;
		void date;
		if (app) updateTitleMeta();
	});
	$effect(() => {
		void sky.hoverCode;
		if (app) drawHover();
	});
	$effect(() => {
		void sky.selectedCode;
		if (app) drawSelected();
	});
</script>

<div class="pixel-map" bind:this={host}></div>

<style>
	.pixel-map {
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
		touch-action: none;
	}
	.pixel-map :global(canvas) {
		display: block;
	}
</style>
