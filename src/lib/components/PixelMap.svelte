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
	import {
		Application,
		Container,
		Sprite,
		Texture,
		Graphics,
		Text,
		Rectangle,
		type Ticker
	} from 'pixi.js';
	import type { FeatureCollection } from 'geojson';
	import type { StationsManifest } from '$lib/types';
	import {
		CELL,
		SKY,
		skyMode,
		coverTier,
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
	import { buildMarkAtlas, MARK_VARIANTS } from '$lib/map/sprites';
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
		onlayout?: (info: {
			gutter: number;
			zoomRatio: number;
			view: { x: number; y: number; w: number; h: number };
			world: { w: number; h: number };
			/** Live canvas-px position of the streak board's world anchor (open sea
			    south of the landmass), so the HTML board can be pinned into the world. */
			streak: { x: number; y: number };
		}) => void;
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
	// Per-tier label thresholds as multiples of the START zoom (the opening view):
	// megacities appear first, then major cities, then a sparse SAMPLE of smaller
	// cities. Index = place.tier (0 megacity, 1 major city ≥1M, 2 city ≥200k, 3
	// town). Towns are Infinity — never labelled. Tier 2 comes in just after the
	// majors so regions with no big city (NE, west coast) still get labels; the
	// wide per-tier spacing (TIER_GAP2) is what keeps it a sample, not a swarm.
	const TIER_ZOOM = [1.6, 3.2, 3.6, Infinity];
	const BAND_OFFSET: Record<BandKey, number> = {
		high: -TOWER_GAP,
		middle: 0,
		low: TOWER_GAP
	};
	const BAND_KEYS: BandKey[] = ['low', 'middle', 'high'];
	const VAL_KEY: Record<BandKey, 'h' | 'm' | 'l'> = { high: 'h', middle: 'm', low: 'l' };
	const SHADOW_DROP = TOWER_GAP + MARK_CELL * 2.5;
	const WAVE_SCALE = 1.25;
	const WAVE_MAX = 100;
	// Easter egg: a lone hot air balloon wandering across the landmass on the wind
	// — its heading is steered by smooth noise.
	const BALLOON_SPEED = 1024 / 520000;

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

	// Dev camera inspector: toggle with the "d" key. Shows live pan/zoom + cursor
	// world coords, and lets you jump the camera to typed coordinates.
	let showDebug = $state(false);
	let dbg = $state({ panX: 0, panY: 0, zoom: 1, wx: 0, wy: 0 });
	let dbgForm = $state({ panX: 0, panY: 0, zoom: 1 });
	function applyDebug() {
		userMoved = true;
		panX = dbgForm.panX;
		panY = dbgForm.panY;
		zoom = dbgForm.zoom;
		applyCamera();
	}

	const STORY_TITLE = "MAPPING INDIA'S CLOUDS";
	const STORY_SUB = 'How cloudy is India today?';
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
	let titleBrandGroup: Container | null = null;
	let titleBrand: Text | null = null;
	let titleBalloon: Sprite | null = null;
	let titleBalloonBaseY = 0;
	let titleBox: Graphics | null = null;
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
	let balloonLayer: Container | null = null;
	let balloonTex: Texture | null = null;
	let balloonBounds: { minX: number; maxX: number; minY: number; maxY: number } | null = null;
	let balloon: { c: Container; x: number; y: number; phase: number } | null = null;
	// Two independent smooth-noise channels steer the balloon's heading, so it
	// wanders and criss-crosses the map like it's being carried on the wind.
	let balloonNoiseX: ((t: number) => number) | null = null;
	let balloonNoiseY: ((t: number) => number) | null = null;
	const pool: Record<BandKey, Sprite[]> = { low: [], middle: [], high: [] };
	let layers: Record<BandKey, Container> | null = null;
	const alphaTarget: Record<BandKey, number> = { low: 1, middle: 1, high: 1 };
	let cloudTex: Record<BandKey, Texture[][]> = { low: [], middle: [], high: [] };
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

	// "Pan aside" mode: on phones the streaks overlay glides the camera south into
	// open ocean so the leaderboard reads as a place out at sea rather than a sheet
	// dropped on top. While active the map ignores pointer/wheel input.
	let asideActive = false;
	let interactionLocked = false;
	let asideClearPx = 0; // screen px to keep clear below the land for the streak board
	let landBottomWorldY = 0; // world Y of India's southern tip (computed once)
	let camAnim: {
		fromX: number;
		fromY: number;
		fromZ: number;
		toX: number;
		toY: number;
		toZ: number;
		t: number;
		dur: number;
	} | null = null;
	// The streak board lives at a fixed spot in the open sea south of India, given
	// as fractions of the fit view. fy > 0.5 puts it below the landmass, so at fit
	// it sits off the bottom and the aside pan slides it up into view.
	const STREAK_ANCHOR = { fx: 0.07, fy: 0.9 };

	function easeInOut(x: number): number {
		return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
	}
	function streakAnchorWorld() {
		const sv = startView();
		return { x: sv.x + STREAK_ANCHOR.fx * sv.w, y: sv.y + STREAK_ANCHOR.fy * sv.h };
	}
	// Southernmost land row, so the aside pan can seat India's tip just above the
	// board. A small per-row threshold skips 1–2px specks (stray far-south islands).
	function computeLandBottom(): number {
		const g = geo!;
		for (let y = g.rows - 1; y >= 0; y--) {
			let n = 0;
			for (let x = 0; x < g.cols; x++) if (g.land[y * g.cols + x]) n++;
			if (n >= 4) return (y + 1) * g.groundScale;
		}
		return g.worldH;
	}

	// World-space bounds of the landmass, so the drifting balloon can be kept over
	// India rather than wandering out to sea.
	function computeLandBBox() {
		const g = geo!;
		let minX = g.cols,
			maxX = 0,
			minY = g.rows,
			maxY = 0,
			found = false;
		for (let y = 0; y < g.rows; y++) {
			for (let x = 0; x < g.cols; x++) {
				if (!g.land[y * g.cols + x]) continue;
				found = true;
				if (x < minX) minX = x;
				if (x > maxX) maxX = x;
				if (y < minY) minY = y;
				if (y > maxY) maxY = y;
			}
		}
		if (!found) return { minX: 0, maxX: g.worldW, minY: 0, maxY: g.worldH };
		const gc = g.groundScale;
		return { minX: minX * gc, maxX: (maxX + 1) * gc, minY: minY * gc, maxY: (maxY + 1) * gc };
	}

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
		// Desktop opens zoomed in (not at full fit); phones open tighter still.
		return narrowLayout() ? 1.7 : 1.25;
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
		// Desktop: open with the world shoved as far left as the opening view allows,
		// so the right sea gutter (holding the title lockup) sits fully in frame.
		if (!narrowLayout()) {
			const b = worldBBox();
			const gutterWorld = (vw / containZoom() - (b.maxX - b.minX)) / 2;
			panX = b.maxX + gutterWorld - v.w;
		}
		applyCamera();
	}
	function applyCamera() {
		if (!camera) return;
		camera.scale.set(zoom);
		camera.position.set(-panX * zoom, -panY * zoom);
		if (lods.length) applyLod(lodForZoom());
		updatePlacesScale();
		declutterPlaces();
		updateTitleFade();
		emitLayout();
		if (showDebug) {
			dbg.panX = panX;
			dbg.panY = panY;
			dbg.zoom = zoom;
		}
	}

	function emitLayout() {
		if (!geo) return;
		const b = worldBBox();
		const g = geo;
		const a = streakAnchorWorld();
		onlayout?.({
			gutter: (vw - (b.maxX - b.minX) * containZoom()) / 2,
			// Relative to the OPENING view (which is a bit zoomed in on desktop), so
			// "zoomed" chrome and the gutter panels read 1 at the start, not >1.
			zoomRatio: zoom / (containZoom() * startZoomFactor()),
			view: { x: panX, y: panY, w: vw / zoom, h: vh / zoom },
			world: { w: g.worldW, h: g.worldH },
			streak: { x: (a.x - panX) * zoom, y: (a.y - panY) * zoom }
		});
	}

	// Camera target for the two aside states. When aside, seat India's southern tip
	// exactly `asideClearPx` above the frame bottom — just enough room for the board
	// plus its padding — so there's no overlap and no wasted ocean.
	function asideTarget(on: boolean) {
		const v = startView();
		const z = containZoom() * startZoomFactor();
		if (!on) return { x: v.x, y: v.y, z };
		const tipScreenY = Math.max(0, vh - asideClearPx);
		return { x: v.x, y: landBottomWorldY - tipScreenY / z, z };
	}
	export function panAside(on: boolean, clearPx = 0) {
		if (!geo) return;
		const wasActive = asideActive;
		if (on) asideClearPx = clearPx;
		asideActive = on;
		interactionLocked = on;
		if (!on) userMoved = false;
		const t = asideTarget(on);
		// Snap (no re-animate) under reduced-motion, or when just re-seating an
		// already-open board after its measured height changed.
		if (reduced || (wasActive && on)) {
			camAnim = null;
			panX = t.x;
			panY = t.y;
			zoom = t.z;
			applyCamera();
			return;
		}
		if (on === wasActive) return;
		camAnim = {
			fromX: panX,
			fromY: panY,
			fromZ: zoom,
			toX: t.x,
			toY: t.y,
			toZ: t.z,
			t: 0,
			dur: 620
		};
	}

	function updatePlacesScale() {
		if (!placeMarkers.length) return;
		const s = 1 / zoom;
		for (const m of placeMarkers) m.scale.set(s);
	}

	// Decide which city labels are drawn: gate each by its tier's zoom threshold,
	// then greedily thin overlaps in screen space (places are pop-sorted, so the
	// most prominent city in any cluster wins). Cheap because we only collision-
	// test the handful that pass the LOD gate and fall inside the viewport.
	function declutterPlaces() {
		if (!placesLayer || !geo) return;
		// Gate against the START zoom, not raw fit: phones open at 1.7× fit, so
		// measuring from fit would show labels by default. From the opening view
		// zr === 1 on every device, and labels only appear as you zoom further in.
		const zr = zoom / (containZoom() * startZoomFactor());
		// Nothing qualifies until we're past the first (megacity) threshold.
		placesLayer.visible = zr >= TIER_ZOOM[0];
		if (!placesLayer.visible) return;

		const placed: { l: number; r: number; t: number; b: number; ax: number; ay: number }[] = [];
		const M = 40; // viewport margin so labels near the edge still declutter
		// Minimum spacing between label anchors (screen px), by the CANDIDATE's tier.
		// Because places are walked biggest-first, a city is suppressed if it falls
		// within its own radius of anything already placed. Big cities pack tighter;
		// the ≥200k tier demands a wide berth, so only a sparse sample of them shows
		// — filling the gaps between the majors rather than crowding every one in.
		const TIER_GAP2 = [92 * 92, 92 * 92, 160 * 160, Infinity];
		for (let i = 0; i < placeMarkers.length; i++) {
			const p = geo.places[i];
			const m = placeMarkers[i];
			if (zr < TIER_ZOOM[p.tier]) {
				m.visible = false;
				continue;
			}
			const sx = (p.px - panX) * zoom;
			const sy = (p.py - panY) * zoom;
			if (sx < -M || sx > vw + M || sy < -M || sy > vh + M) {
				m.visible = false;
				continue;
			}
			// Marker renders at native px on screen (its 1/zoom scale cancels the
			// camera zoom), so the label's own width/height are the screen rect.
			const label = placeLabels[i];
			const l = sx - 3;
			const r = sx + 5 + label.width + 3; // GAP(5) + text + pad
			const t = sy - label.height / 2 - 2;
			const b = sy + label.height / 2 + 2;
			const gap2 = TIER_GAP2[p.tier];
			let hit = false;
			for (const q of placed) {
				// Reject on either a rectangle overlap OR anchors closer than this
				// tier's gap, so nearby-but-not-touching labels yield to bigger cities.
				const dx = sx - q.ax;
				const dy = sy - q.ay;
				if (dx * dx + dy * dy < gap2 || (l < q.r && r > q.l && t < q.b && b > q.t)) {
					hit = true;
					break;
				}
			}
			if (hit) {
				m.visible = false;
				continue;
			}
			m.visible = true;
			placed.push({ l, r, t, b, ax: sx, ay: sy });
		}
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
		drawSelected();
		drawHover();
	}

	async function init() {
		if (!host) return;
		await document.fonts.load("10px 'Ships Whistle'").catch(() => {});
		const atlas = buildMarkAtlas(MARK_CELL);
		const [mask, dayTex, nightTex] = await Promise.all([
			loadGroundMask(groundMaskUrl).catch(() => undefined),
			loadTex(groundDayUrl),
			loadTex(groundNightUrl)
		]);
		groundTex = { day: dayTex, night: nightTex };
		geo = buildGeo(india, manifest, WORLD_W, CELL, places, mask);
		landBottomWorldY = computeLandBottom();
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
		// 'passive' (not 'none') so the brand group below can still receive its click.
		titleGroup.eventMode = 'passive';
		titleBox = new Graphics();
		titleText = new Text({ text: STORY_TITLE, style: { ...titleFont, fontWeight: '700' } });
		titleSub = new Text({ text: STORY_SUB, style: { ...titleFont, fontWeight: '400' } });
		titleMeta = new Text({ text: '', style: { ...titleFont, fontWeight: '700' } });
		// Brand kicker above the box: "DIAGRAM CHASING" with the balloon bobbing beside
		// it. The balloon sprite is added later, once its texture is built.
		titleBrand = new Text({
			text: 'DIAGRAM CHASING',
			style: { ...titleFont, fontWeight: '700' }
		});
		titleBrand.anchor.set(0, 0.5);
		// The brand row (text + balloon) is a clickable link to the studio site.
		titleBrandGroup = new Container();
		titleBrandGroup.eventMode = 'static';
		titleBrandGroup.cursor = 'pointer';
		titleBrandGroup.on('pointertap', () =>
			window.open('https://diagramchasing.fun', '_blank', 'noopener')
		);
		titleBrandGroup.addChild(titleBrand);
		titleGroup.addChild(titleBox, titleText, titleSub, titleMeta, titleBrandGroup);
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
		shadowPool = Array.from({ length: maxBins }, () => {
			const s = new Sprite(cloudTex.low[1][0]);
			s.anchor.set(0.5, 0.5);
			s.tint = SHADOW_TINT;
			s.visible = false;
			shadowLayer!.addChild(s);
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

		buildBalloon();
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
		if (!titleGroup || !titleBox || !titleText || !titleSub || !titleMeta || !geo) return;
		const b = worldBBox();
		const gutter = (vw / containZoom() - (b.maxX - b.minX)) / 2;
		const narrow = gutter < 90;

		const unit = 30;
		const pad = unit * 0.72; // inner box padding
		const gap = unit * 0.5; // vertical gap between stacked rows

		titleText.style.fontSize = unit;
		titleText.style.fontWeight = '700';
		titleText.style.letterSpacing = unit * 0.02;
		titleSub.style.fontSize = unit * 0.7;
		const metaFS = narrow ? unit * 0.46 : unit * 0.6;
		titleMeta.style.fontSize = metaFS;
		titleMeta.style.letterSpacing = unit * 0.03;
		for (const t of [titleText, titleSub, titleMeta]) t.style.fill = 0xffffff;
		if (titleBrand) {
			titleBrand.style.fontSize = unit * 0.5;
			titleBrand.style.letterSpacing = unit * 0.08;
			titleBrand.style.fill = 0xffffff;
		}

		// One box wraps title + subtitle; the date/time meta sits just below, outside it.
		const innerW = Math.max(titleText.width, titleSub.width);
		const boxW = innerW + pad * 2;

		// Brand kicker row above the box: "DIAGRAM CHASING" with the balloon bobbing
		// beside it, the whole row centred over the lockup.
		const rowGap = unit * 0.45;
		let brandW = 0;
		let brandH = 0;
		let balloonW = 0;
		let balloonH = 0;
		if (titleBrand) {
			brandW = titleBrand.width;
			brandH = titleBrand.height;
			if (titleBalloon) {
				const tex = titleBalloon.texture;
				balloonH = brandH * 1.3;
				balloonW = balloonH * (tex.width / tex.height);
			}
		}
		const brandRowH = Math.max(brandH, balloonH);
		const brandGap = titleBrand ? gap * 1.2 : 0;
		const rowW = brandW + (titleBalloon ? rowGap + balloonW : 0);

		let by = brandRowH + brandGap;
		const boxTop = by;
		by += pad;
		const titleY = by;
		by += titleText.height + gap;
		const subY = by;
		by += titleSub.height;
		const boxBottom = by + pad;
		const boxH = boxBottom - boxTop;

		const groupW = Math.max(boxW, titleMeta.width, rowW);
		const gcx = groupW / 2;
		const boxX = gcx - boxW / 2;

		if (titleBrand) {
			const brandCY = brandRowH / 2;
			const rowX0 = gcx - rowW / 2;
			titleBrand.position.set(rowX0, brandCY);
			if (titleBalloon) {
				titleBalloon.scale.set(balloonH / titleBalloon.texture.height);
				titleBalloon.position.set(rowX0 + brandW + rowGap + balloonW / 2, brandCY);
				titleBalloonBaseY = brandCY;
			}
			// Click target spans the whole brand row.
			if (titleBrandGroup) titleBrandGroup.hitArea = new Rectangle(rowX0, 0, rowW, brandRowH);
		}

		// Centre title + subtitle in the box; meta is placed below by updateTitleMeta().
		titleText.position.set(gcx - titleText.width / 2, titleY);
		titleSub.position.set(gcx - titleSub.width / 2, subY);
		titleCx = gcx;
		titleMetaAlignRight = false;
		titleMetaY = boxBottom + gap * 1.5;
		const groupH = titleMetaY + titleMeta.height;

		titleBox.clear();
		titleBox
			.rect(boxX, boxTop, boxW, boxH)
			.stroke({ width: Math.max(1, unit * 0.045), color: 0xffffff, alignment: 0 });

		titleShown = true;

		// Live in world space so the lockup pans and zooms stuck to the map. Desktop
		// parks it in the RIGHT sea gutter, vertically centred; phones tuck the compact
		// lockup into the top-right sky of the opening view.
		if (!narrow) {
			const s = Math.min((gutter * 0.8) / groupW, (geo.worldH * 0.55) / groupH);
			titleGroup.scale.set(s);
			// TITLE_GUTTER_POS: where in the right gutter the lockup sits, 0 = flush
			// against India's east edge, 0.5 = centred, 1 = far sea. Lower it to nudge
			// the title left.
			const TITLE_GUTTER_POS = -0.5;
			titleGroup.position.set(
				b.maxX + (gutter - groupW * s) * TITLE_GUTTER_POS,
				geo.worldH / 2 - (groupH * s) / 2
			);
		} else {
			const v = startView();
			const s = Math.min((v.w * 0.5) / groupW, (v.h * 0.22) / groupH);
			const mx = v.w * 0.05;
			titleGroup.scale.set(s);
			titleGroup.position.set(v.x + v.w - groupW * s - mx, v.y * 0.2 + mx);
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

	// Font size by population tier (0 megacity … 3 town), matching TIER_ZOOM.
	function placeSize(tier: number): number {
		return [19, 16, 13, 11][tier] ?? 11;
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
					fontSize: placeSize(p.tier),
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

	// A pixel hot air balloon in the style of the reference: a rounded onion-shaped
	// envelope with vertical gore seams, a short suspension gap, then a small basket
	// hanging below. White with a few grey tones for the seams / shaded side.
	const BALLOON_W = 15;
	// Envelope half-width per row (from centre col 7): swells near the top then
	// tapers to a point, giving the teardrop/onion outline.
	const BALLOON_HALF = [2, 3, 4, 5, 6, 7, 7, 7, 7, 6, 6, 5, 5, 4, 4, 3, 3, 2, 1];
	const BALLOON_SEAMS = [4, 7, 10]; // gore seam columns
	function buildBalloonTex(): Texture {
		const cx = 7;
		const envH = BALLOON_HALF.length;
		const c = makeCanvas(BALLOON_W, envH + 6);
		const ctx = c.getContext('2d')!;
		ctx.imageSmoothingEnabled = false;
		const W1 = '#ffffff'; // envelope body
		const W2 = '#c4ccd4'; // seams + rim
		const W3 = '#e2e7ec'; // dither on the shaded (right) side
		BALLOON_HALF.forEach((h, y) => {
			const a = cx - h;
			const b = cx + h;
			for (let x = a; x <= b; x++) {
				let col = W1;
				if (x === a || x === b)
					col = W2; // soft rounded rim
				else if (BALLOON_SEAMS.includes(x))
					col = W2; // gore seam
				else if (x > cx && ((x + y) & 1) === 0) col = W3; // shaded-side dither
				ctx.fillStyle = col;
				ctx.fillRect(x, y, 1, 1);
			}
		});
		// Suspension ropes drop from the envelope base, leaving a gap of open sky.
		ctx.fillStyle = W2;
		for (const y of [envH, envH + 1]) {
			ctx.fillRect(cx - 1, y, 1, 1);
			ctx.fillRect(cx + 1, y, 1, 1);
		}
		// Basket: a small block, its top rim brighter.
		for (let y = envH + 2; y <= envH + 4; y++) {
			for (let x = cx - 1; x <= cx + 1; x++) {
				ctx.fillStyle = y === envH + 2 ? W1 : W2;
				ctx.fillRect(x, y, 1, 1);
			}
		}
		return mkTex(c);
	}

	// Smooth 1-D value noise in [0,1): random values at integers, smoothstepped
	// between — cheap wind-like wander without any per-frame randomness.
	function makeNoise(seed: number): (t: number) => number {
		const rand = mulberry32(seed);
		const grad = Array.from({ length: 256 }, () => rand());
		return (t: number) => {
			const i = Math.floor(t);
			const f = t - i;
			const u = f * f * (3 - 2 * f);
			const a = grad[i & 255];
			const b = grad[(i + 1) & 255];
			return a + (b - a) * u;
		};
	}

	function buildBalloon() {
		if (!geo || !camera) return;
		balloonTex = buildBalloonTex();
		balloonLayer = new Container();
		balloonLayer.eventMode = 'none';
		camera.addChild(balloonLayer);
		balloonBounds = computeLandBBox();
		balloonNoiseX = makeNoise(fnv1a('balloon-x'));
		balloonNoiseY = makeNoise(fnv1a('balloon-y'));
		const b = balloonBounds;
		const sp = new Sprite(balloonTex);
		sp.anchor.set(0.5, 1); // pivot at the basket so the balloon hangs from a point
		sp.scale.set(0.7);
		const c = new Container();
		c.eventMode = 'none';
		c.addChild(sp);
		balloonLayer.addChild(c);
		balloon = {
			c,
			x: b.minX + (b.maxX - b.minX) * 0.4,
			y: b.minY + (b.maxY - b.minY) * 0.4,
			phase: 0
		};
		c.x = balloon.x;
		c.y = balloon.y;

		// A second, static balloon rides in the title lockup beside the brand line.
		if (titleBrandGroup && balloonTex) {
			titleBalloon = new Sprite(balloonTex);
			titleBalloon.anchor.set(0.5, 0.5);
			titleBalloon.tint = 0xffffff;
			titleBrandGroup.addChild(titleBalloon);
		}
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

	function styleAmbient() {
		const mode = skyMode(sky.timeIndex);
		const night = mode === 'night';
		if (balloon) (balloon.c.children[0] as Sprite).tint = night ? 0x9fb0cc : 0xffffff;
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
		hoverGfx.rect(box.x, box.y, box.w, box.h).stroke({ width: 2, color: 0xffffff, alignment: 0.5 });
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
		if (camAnim) {
			camAnim.t += t.deltaMS;
			const e = easeInOut(Math.min(1, camAnim.t / camAnim.dur));
			panX = camAnim.fromX + (camAnim.toX - camAnim.fromX) * e;
			panY = camAnim.fromY + (camAnim.toY - camAnim.fromY) * e;
			zoom = camAnim.fromZ + (camAnim.toZ - camAnim.fromZ) * e;
			applyCamera();
			if (camAnim.t >= camAnim.dur) camAnim = null;
		}
		if (layers) {
			for (const band of BAND_KEYS) {
				const layer = layers[band];
				const target = alphaTarget[band];
				if (reduced || Math.abs(layer.alpha - target) < 0.004) layer.alpha = target;
				else layer.alpha += (target - layer.alpha) * Math.min(1, t.deltaMS / 90);
			}
		}
		if (titleBalloon && !reduced) {
			titleBalloon.y = titleBalloonBaseY + Math.sin(performance.now() / 650) * 2;
		}
		if (reduced || sky.view !== 'today') return;
		const now = performance.now();
		if (now - lastDrift > 1200) {
			lastDrift = now;
			driftTick = (driftTick + 1) % 4;
			if (layers) layers.high.x = driftTick * 2 * (lodIndex < 0 ? 1 : lods[lodIndex].scale);
			for (const w of waves) w.s.texture = waveTex[(driftTick + w.phase) & 1];
		}
		if (balloon && balloonBounds && balloonNoiseX && balloonNoiseY) {
			const b = balloonBounds;
			balloon.phase += t.deltaMS;
			// Heading comes from two slow noise channels → a smooth wandering path
			// that criss-crosses instead of tracking straight.
			const F = 0.00006;
			let vx = balloonNoiseX(balloon.phase * F) * 2 - 1;
			let vy = balloonNoiseY(balloon.phase * F * 1.3) * 2 - 1;
			// Steer back inside as it nears the coastline so it stays over India.
			const margin = 60;
			if (balloon.x < b.minX + margin) vx += (b.minX + margin - balloon.x) / margin;
			if (balloon.x > b.maxX - margin) vx -= (balloon.x - (b.maxX - margin)) / margin;
			if (balloon.y < b.minY + margin) vy += (b.minY + margin - balloon.y) / margin;
			if (balloon.y > b.maxY - margin) vy -= (balloon.y - (b.maxY - margin)) / margin;
			const m = Math.hypot(vx, vy) || 1;
			balloon.x += (vx / m) * BALLOON_SPEED * t.deltaMS;
			balloon.y += (vy / m) * BALLOON_SPEED * t.deltaMS;
			balloon.c.x = balloon.x;
			balloon.c.y = balloon.y;
		}
	}

	function clientToWorld(clientX: number, clientY: number) {
		const rect = app!.canvas.getBoundingClientRect();
		return { ox: panX + (clientX - rect.left) / zoom, oy: panY + (clientY - rect.top) / zoom };
	}
	let dragging = false;
	let moved = false;
	let last = { x: 0, y: 0 };
	// Live touch/pointer points, keyed by pointerId. With two or more down we switch
	// from one-finger pan into pinch mode; `pinch` caches the last gesture midpoint
	// and finger spread so each move can derive a zoom factor + pan delta.
	const pointers = new Map<number, { x: number; y: number }>();
	let pinch: { cx: number; cy: number; dist: number } | null = null;

	function pinchGeom() {
		const pts = [...pointers.values()];
		const a = pts[0];
		const b = pts[1];
		return {
			cx: (a.x + b.x) / 2,
			cy: (a.y + b.y) / 2,
			dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
		};
	}
	function bindPointer() {
		const c = app!.canvas;
		c.addEventListener('pointerdown', (e) => {
			if (interactionLocked) return;
			pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
			c.setPointerCapture(e.pointerId);
			userMoved = true;
			if (pointers.size === 1) {
				dragging = true;
				moved = false;
				last = { x: e.clientX, y: e.clientY };
			} else if (pointers.size === 2) {
				// Second finger down: end single-finger drag, begin pinch. Mark as
				// moved so the lift-off never registers as a tap-to-select.
				dragging = false;
				moved = true;
				pinch = pinchGeom();
			}
		});
		c.addEventListener('pointermove', (e) => {
			if (interactionLocked) return;
			if (showDebug) {
				const w = clientToWorld(e.clientX, e.clientY);
				dbg.wx = Math.round(w.ox);
				dbg.wy = Math.round(w.oy);
			}
			if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
			if (pinch && pointers.size >= 2) {
				const g = pinchGeom();
				// Two-finger translation pans; changing spread zooms about the midpoint.
				panX -= (g.cx - pinch.cx) / zoom;
				panY -= (g.cy - pinch.cy) / zoom;
				zoomAt(g.cx, g.cy, g.dist / pinch.dist);
				pinch = g;
				return;
			}
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
		const endPointer = (e: PointerEvent) => {
			if (interactionLocked) {
				pointers.delete(e.pointerId);
				return;
			}
			const wasTap = dragging && !moved && pointers.size === 1;
			pointers.delete(e.pointerId);
			if (pointers.size < 2) pinch = null;
			if (pointers.size === 1) {
				// Dropped from pinch back to one finger: resume panning from whichever
				// finger is still down so the map doesn't jump.
				const [only] = pointers.values();
				dragging = true;
				moved = true;
				last = { x: only.x, y: only.y };
				return;
			}
			if (pointers.size === 0) dragging = false;
			if (wasTap) {
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
		};
		c.addEventListener('pointerup', endPointer);
		c.addEventListener('pointercancel', endPointer);
		c.addEventListener('pointerleave', () => {
			sky.hoverCode = null;
			drawHover();
			onhover?.(null);
		});
		c.addEventListener(
			'wheel',
			(e) => {
				if (interactionLocked) return;
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
		// Phones may zoom further out (down to 0.4× fit); desktop stays near fit.
		const minZoom = fit * (narrowLayout() ? 0.4 : 0.9);
		zoom = Math.max(minZoom, Math.min(fit * 7, zoom * factor));
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
			if (asideActive) {
				const t = asideTarget(true);
				camAnim = null;
				panX = t.x;
				panY = t.y;
				zoom = t.z;
				applyCamera();
			} else if (!userMoved) fitCamera();
			else emitLayout();
		});
		ro.observe(host);
		const onkey = (e: KeyboardEvent) => {
			const el = e.target as HTMLElement | null;
			if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
			if (e.key === 'd' || e.key === 'D') {
				showDebug = !showDebug;
				if (showDebug) {
					dbgForm.panX = Math.round(panX);
					dbgForm.panY = Math.round(panY);
					dbgForm.zoom = +zoom.toFixed(4);
					dbg.panX = panX;
					dbg.panY = panY;
					dbg.zoom = zoom;
				}
			}
		};
		window.addEventListener('keydown', onkey);
		init();
		return () => {
			mq.removeEventListener('change', onmq);
			ro.disconnect();
			window.removeEventListener('keydown', onkey);
			app?.destroy(true);
			app = null;
		};
	});

	$effect(() => {
		void values;
		if (app) {
			updateClouds();
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

<div
	class="pixel-map relative h-full w-full touch-none overflow-hidden [&_canvas]:block"
	bind:this={host}
>
	{#if showDebug}
		<div class="dbg">
			<div class="dbg-title">CAMERA (press D to hide)</div>
			<label>panX <input type="number" bind:value={dbgForm.panX} /></label>
			<label>panY <input type="number" bind:value={dbgForm.panY} /></label>
			<label>zoom <input type="number" step="0.01" bind:value={dbgForm.zoom} /></label>
			<div class="dbg-btns">
				<button onclick={applyDebug}>Apply</button>
				<button
					onclick={() => {
						userMoved = false;
						fitCamera();
					}}>Reset</button
				>
			</div>
			<div class="dbg-live">
				live pan {dbg.panX.toFixed(1)}, {dbg.panY.toFixed(1)} · z {dbg.zoom.toFixed(3)}<br />
				cursor world {dbg.wx}, {dbg.wy}
			</div>
		</div>
	{/if}
</div>

<style>
	/* Debug HUD: intentionally left as vanilla CSS — dev-only chrome, deliberately off-palette in real monospace. */
	.dbg {
		position: absolute;
		top: 8px;
		left: 8px;
		z-index: 50;
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 8px 10px;
		background: rgba(4, 7, 15, 0.85);
		border: 1px solid #2a3a5a;
		color: #cfe4ff;
		font: 11px/1.4 monospace;
	}
	.dbg-title {
		font-weight: 700;
		letter-spacing: 0.04em;
		margin-bottom: 2px;
	}
	.dbg label {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 10px;
	}
	.dbg input {
		width: 100px;
		padding: 2px 4px;
		background: #0b1d3a;
		border: 1px solid #2a3a5a;
		color: #fff;
		font: 11px monospace;
	}
	.dbg-btns {
		display: flex;
		gap: 6px;
		margin-top: 2px;
	}
	.dbg-btns button {
		flex: 1;
		padding: 3px 6px;
		background: #12305a;
		border: 1px solid #2a3a5a;
		color: #fff;
		font: 11px monospace;
		cursor: pointer;
	}
	.dbg-btns button:hover {
		background: #1b427a;
	}
	.dbg-live {
		margin-top: 4px;
		opacity: 0.8;
	}
</style>
