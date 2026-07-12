<script lang="ts" module>
	export interface HoverInfo {
		code: string;
		clientX: number;
		clientY: number;
		members: number;
		agg?: { h: number; m: number; l: number };
	}
</script>

<script lang="ts">
	import { untrack } from 'svelte';
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
	import { userGeo } from '$lib/state/geo.svelte';
	import { click, tap } from '$lib/feedback';

	interface Props {
		india: FeatureCollection;
		places?: FeatureCollection;
		manifest: StationsManifest;
		values: Record<string, { h: number; m: number; l: number }>;
		enableTooltip?: boolean;
		date?: string;
		onhover?: (info: HoverInfo | null) => void;
		onselect?: (code: string, at?: { x: number; y: number }) => void;
		onlayout?: (info: {
			gutter: number;
			zoomRatio: number;
			view: { x: number; y: number; w: number; h: number };
			world: { w: number; h: number };
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
	const STORY_SUB = "A daily map of where it's cloudy";
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
	// Only the texture for the sky mode visible at init is loaded critically; the
	// other mode fills in on idle, so either key can be briefly absent.
	let groundTex: Partial<Record<'day' | 'night', Texture>> | null = null;
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
	let userLayer: Container | null = null;
	let userMarker: Container | null = null;
	let userPulse: Graphics | null = null;
	let userOnMap = false;
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
	// The finest (per-station) LOD and its larger sprite pools are built lazily the
	// first time the user zooms all the way in — not on the critical first-paint path.
	let finestBuilt = false;
	// Set in the $effect cleanup so late font/idle callbacks don't touch a torn-down app.
	let destroyed = false;
	const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
	const onIdle = (cb: () => void) => {
		const w = window as unknown as { requestIdleCallback?: (cb: () => void) => void };
		if (w.requestIdleCallback) w.requestIdleCallback(cb);
		else setTimeout(cb, 1);
	};
	let balloonLayer: Container | null = null;
	let balloonTex: Texture | null = null;
	let balloonBounds: { minX: number; maxX: number; minY: number; maxY: number } | null = null;
	let balloon: { c: Container; x: number; y: number; phase: number } | null = null;
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
		onlayout?.({
			gutter: (vw - (b.maxX - b.minX) * containZoom()) / 2,

			zoomRatio: zoom / (containZoom() * startZoomFactor()),
			view: { x: panX, y: panY, w: vw / zoom, h: vh / zoom },
			world: { w: g.worldW, h: g.worldH }
		});
	}

	function updatePlacesScale() {
		if (userMarker) userMarker.scale.set(1 / zoom);
		if (!placeMarkers.length) return;
		const s = 1 / zoom;
		for (const m of placeMarkers) m.scale.set(s);
	}

	// "You are here": a pixel-square marker at the visitor's coarse (IP) location,
	// matching the map's square place dots rather than a round pin. Built once;
	// positioned/toggled whenever the resolved location changes. Hidden when the
	// visitor is outside the projected India frame (e.g. abroad).
	function buildUserMarker() {
		if (!camera) return;
		userLayer = new Container();
		userLayer.eventMode = 'none';
		userLayer.visible = false;
		const m = new Container();
		const pulse = new Graphics();
		pulse.rect(-6, -6, 12, 12).stroke({ width: 1.5, color: UI.accent, alignment: 0.5 });
		m.addChild(pulse);
		userPulse = pulse;
		const dot = new Graphics();
		dot.rect(-4, -4, 8, 8).fill({ color: 0xffffff });
		dot.rect(-2.5, -2.5, 5, 5).fill({ color: UI.accent });
		m.addChild(dot);
		userLayer.addChild(m);
		userMarker = m;
		camera.addChild(userLayer);
	}

	function updateUserMarker() {
		if (!userLayer || !geo) return;
		const loc = userGeo.loc;
		const p = loc ? geo.project(loc.lng, loc.lat) : null;
		if (!p) {
			userLayer.visible = false;
			userOnMap = false;
			return;
		}
		const [x, y] = p;
		const b = worldBBox();
		if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) {
			userLayer.visible = false;
			userOnMap = false;
			return;
		}
		userLayer.position.set(x, y);
		userLayer.visible = true;
		userOnMap = true;
		if (userMarker) userMarker.scale.set(1 / zoom);
	}

	function declutterPlaces() {
		if (!placesLayer || !geo) return;

		const zr = zoom / (containZoom() * startZoomFactor());
		placesLayer.visible = zr >= TIER_ZOOM[0];
		if (!placesLayer.visible) return;

		const placed: { l: number; r: number; t: number; b: number; ax: number; ay: number }[] = [];
		const M = 40;
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

			const label = placeLabels[i];
			const l = sx - 3;
			const r = sx + 5 + label.width + 3;
			const t = sy - label.height / 2 - 2;
			const b = sy + label.height / 2 + 2;
			const gap2 = TIER_GAP2[p.tier];
			let hit = false;
			for (const q of placed) {
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

	function buildLod(bin: number | null): Lod {
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
	}
	// Build only the coarse LODs (bin 24/16/11 ≈ 52/117/273 bins) up front. The
	// finest per-station LOD (~1245 marks) is a lazy placeholder until zoom-in, which
	// keeps first-paint binning + sprite pools ~4× smaller.
	const FINE_LOD = LODS.length - 1;
	function buildLods() {
		lods = LODS.map(({ bin }, i) => (i < FINE_LOD ? buildLod(bin) : (null as unknown as Lod)));
		maxBins = Math.max(...lods.slice(0, FINE_LOD).map((l) => l.bins.length));
	}
	function ensureFineLod() {
		if (finestBuilt) return;
		finestBuilt = true;
		lods[FINE_LOD] = buildLod(LODS[FINE_LOD].bin);
		growPools(lods[FINE_LOD].bins.length);
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
		if (!layers) return;
		// Entering the finest LOD builds it (and grows the pools) on first demand.
		if (i === FINE_LOD && !finestBuilt) ensureFineLod();
		if (i === lodIndex) return;
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

	function buildTitle() {
		if (!camera) return;
		const titleFont = {
			fontFamily: "'Ships Whistle', monospace",
			fill: 0xffffff,
			align: 'left' as const
		};
		titleGroup = new Container();
		titleGroup.eventMode = 'passive';
		titleBox = new Graphics();
		titleText = new Text({ text: STORY_TITLE, style: { ...titleFont, fontWeight: '700' } });
		titleSub = new Text({ text: STORY_SUB, style: { ...titleFont, fontWeight: '400' } });
		titleMeta = new Text({ text: '', style: { ...titleFont, fontWeight: '700' } });

		titleBrand = new Text({
			text: 'DIAGRAM CHASING',
			style: { ...titleFont, fontWeight: '700' }
		});
		titleBrand.anchor.set(0, 0.5);
		titleBrandGroup = new Container();
		titleBrandGroup.eventMode = 'static';
		titleBrandGroup.cursor = 'pointer';
		titleBrandGroup.on('pointertap', () =>
			window.open('https://diagramchasing.fun', '_blank', 'noopener')
		);
		titleBrandGroup.addChild(titleBrand);
		titleGroup.addChild(titleBox, titleText, titleSub, titleMeta, titleBrandGroup);
		camera.addChild(titleGroup);
	}

	// Grow the shadow + cloud-band sprite pools up to `target` entries, appending
	// into the (already z-ordered) layer containers. Called with the coarse count at
	// first paint, then with the per-station count when the finest LOD is entered.
	function growPools(target: number) {
		if (!layers || !shadowLayer) return;
		for (let k = shadowPool.length; k < target; k++) {
			const s = new Sprite(cloudTex.low[1][0]);
			s.anchor.set(0.5, 0.5);
			s.tint = SHADOW_TINT;
			s.visible = false;
			shadowLayer.addChild(s);
			shadowPool.push(s);
		}
		for (const band of BAND_KEYS) {
			const arr = pool[band];
			const layer = layers[band];
			for (let k = arr.length; k < target; k++) {
				const s = new Sprite(cloudTex[band][1][0]);
				s.anchor.set(0.5, 0.5);
				s.visible = false;
				layer.addChild(s);
				arr.push(s);
			}
		}
	}

	async function init() {
		if (!host) return;
		// Kick the font load off the critical path. When it resolves, re-lay the title
		// (and place labels) — both are hidden/faded at the start view, so swapping in
		// the real font metrics is invisible.
		document.fonts
			.load("10px 'Ships Whistle'")
			.then(() => {
				if (destroyed) return;
				drawTitle();
				if (placeMarkers.length) declutterPlaces();
			})
			.catch(() => {});

		// Spin up the WebGL context immediately, un-awaited, so it initialises while
		// the mask + ground texture download/decode. `preference: 'webgl'` keeps the
		// renderer choice deterministic — it matches the renderer chunk the
		// prerendered page modulepreloads, and skips the async WebGPU adapter probe.
		// `app` is only assigned once init resolves, so the $effect teardown's
		// app?.destroy() can't race a half-initialised Application.
		const application = new Application();
		const appReady = application
			.init({
				preference: 'webgl',
				resizeTo: host,
				antialias: false,
				backgroundAlpha: 0,
				resolution: window.devicePixelRatio || 1,
				autoDensity: true
			})
			.then(
				() => true,
				() => false
			);

		const atlas = buildMarkAtlas(MARK_CELL);
		// Only the ground texture for the current sky mode gates first paint; the
		// other mode's texture loads on idle and swaps in via updateGround.
		// untrack: this runs synchronously inside the mounting $effect, and a plain
		// read would register sky.timeIndex as a dependency — the first scrub across
		// it would then tear down and never rebuild the whole Pixi app.
		const mode = untrack(() => skyMode(sky.timeIndex));
		const [mask, groundNow] = await Promise.all([
			loadGroundMask(groundMaskUrl).catch(() => undefined),
			loadTex(mode === 'night' ? groundNightUrl : groundDayUrl)
		]);
		if (destroyed) {
			appReady.then((ok) => ok && application.destroy());
			return;
		}
		groundTex = { [mode]: groundNow };
		const otherMode = mode === 'night' ? 'day' : 'night';
		onIdle(() => {
			if (destroyed) return;
			loadTex(otherMode === 'night' ? groundNightUrl : groundDayUrl)
				.then((t) => {
					if (destroyed || !groundTex) return;
					groundTex[otherMode] = t;
					updateGround();
				})
				.catch(() => {});
		});
		geo = buildGeo(india, manifest, WORLD_W, CELL, places, mask);
		buildLods();

		const ok = await appReady;
		if (destroyed || !host || !ok) {
			if (ok) application.destroy();
			return;
		}
		app = application;
		host.appendChild(app.canvas);
		app.canvas.style.cursor = 'grab';

		skyGfx = new Graphics();
		app.stage.addChild(skyGfx);

		camera = new Container();
		app.stage.addChild(camera);

		groundSprite = new Sprite(groundTex?.[skyMode(sky.timeIndex)] ?? groundNow);
		groundSprite.scale.set(geo.groundScale);
		camera.addChild(groundSprite);

		// Reserve every layer container in its final z-order now. Ambient layers
		// (waves, balloon, places) are created empty here and populated after the
		// first frame, so nothing changes stacking when they fill in later.
		shadowLayer = new Container();
		shadowLayer.eventMode = 'none';
		camera.addChild(shadowLayer);
		createWaveLayer();
		buildTitle();

		const layerMap = {} as Record<BandKey, Container>;
		for (const band of BAND_KEYS) {
			const layer = new Container();
			camera.addChild(layer);
			layerMap[band] = layer;
		}
		layers = layerMap;

		createBalloonLayer();
		createPlacesLayer();

		selGfx = new Graphics();
		camera.addChild(selGfx);
		hoverGfx = new Graphics();
		camera.addChild(hoverGfx);
		buildUserMarker();

		// Cloud textures + coarse sprite pools (shadow + 3 bands).
		cloudTex = { low: [], middle: [], high: [] };
		for (const band of BAND_KEYS) {
			for (let tier = 1; tier <= 4; tier++) {
				cloudTex[band][tier] = [];
				for (let v = 0; v < MARK_VARIANTS; v++) {
					cloudTex[band][tier][v] = mkTex(atlas.get(band, tier as 1 | 2 | 3 | 4, v).canvas);
				}
			}
		}
		growPools(maxBins);
		retargetAlphas();

		fitCamera();
		drawSky();
		drawTitle();
		drawSelected();
		updateUserMarker();
		updateClouds();
		bindPointer();
		app.ticker.add(tick);
		requestAnimationFrame(() => {
			if (!destroyed && !userMoved) fitCamera();
		});

		// First meaningful frame (coarse clouds over India) is ready. Yield, then fill
		// the ambient decoration; places (heaviest) wait for idle since they're hidden
		// until the user zooms in.
		await nextFrame();
		if (destroyed) return;
		fillWaves();
		fillBalloon();
		drawTitle(); // re-seat the title balloon in the brand row
		styleAmbient();
		onIdle(() => {
			if (destroyed) return;
			fillPlaces();
			updatePlacesScale();
			declutterPlaces();
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
		const pad = unit * 0.72;
		const gap = unit * 0.5;

		titleText.style.fontSize = unit;
		titleText.style.fontWeight = '700';
		titleText.style.letterSpacing = unit * 0.02;
		titleSub.style.fontSize = unit * 0.7;
		const metaFS = narrow ? unit * 0.66 : unit * 0.6;
		titleMeta.style.fontSize = metaFS;
		titleMeta.style.letterSpacing = unit * 0.03;
		for (const t of [titleText, titleSub, titleMeta]) t.style.fill = 0xffffff;
		if (titleBrand) {
			titleBrand.style.fontSize = unit * 0.6;
			titleBrand.style.letterSpacing = unit * 0.08;
			titleBrand.style.fill = 0xffffff;
		}

		const innerW = Math.max(titleText.width, titleSub.width);
		const boxW = innerW + pad * 2;
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
			if (titleBrandGroup) titleBrandGroup.hitArea = new Rectangle(rowX0, 0, rowW, brandRowH);
		}

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

		if (!narrow) {
			const s = Math.min((gutter * 0.8) / groupW, (geo.worldH * 0.55) / groupH);
			titleGroup.scale.set(s);
			const TITLE_GUTTER_POS = -0.5;
			titleGroup.position.set(
				b.maxX + (gutter - groupW * s) * TITLE_GUTTER_POS,
				geo.worldH / 2 - (groupH * s) / 2
			);
		} else {
			const v = startView();
			const s = Math.min((v.w * 0.6) / groupW, (v.h * 2) / groupH);
			const mx = v.w * 0.02;
			// Anchor the title a fixed fraction below the top of the landing view rather
			// than scaling v.y (which is negative and aspect-dependent) — the old `v.y * 4`
			// pushed the title off the top of tall/narrow phones.
			const TITLE_TOP_FRAC = 0.11;
			titleGroup.scale.set(s);
			titleGroup.position.set(v.x + v.w - groupW * s - mx, v.y + v.h * TITLE_TOP_FRAC);
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
		// Fade the title out both as you zoom in past the landing view (zr > 1.05) and
		// as you pull the map back below it (zr < 1) — it's anchored in the map world,
		// so without the zoom-out fade it drifts upward instead of disappearing.
		const fadeIn = (1.55 - zr) / (1.55 - 1.05);
		const fadeOut = (zr - 0.8) / (1 - 0.8);
		const fade = Math.max(0, Math.min(1, fadeIn, fadeOut));
		const night = skyMode(sky.timeIndex) === 'night';
		titleGroup.alpha = (night ? 0.72 : 0.6) * fade;
		titleGroup.visible = fade > 0.01;
	}

	function placeSize(tier: number): number {
		return [19, 16, 13, 11][tier] ?? 11;
	}

	// Reserve the (empty) places container in z-order during first paint; the markers
	// are built afterwards in fillPlaces (they're hidden until zoomed in anyway).
	function createPlacesLayer() {
		if (!camera) return;
		placesLayer = new Container();
		placesLayer.eventMode = 'none';
		camera.addChild(placesLayer);
	}
	function fillPlaces() {
		if (!geo || !placesLayer) return;
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

	const BALLOON_W = 15;

	const BALLOON_HALF = [2, 3, 4, 5, 6, 7, 7, 7, 7, 6, 6, 5, 5, 4, 4, 3, 3, 2, 1];
	const BALLOON_SEAMS = [4, 7, 10];
	function buildBalloonTex(): Texture {
		const cx = 7;
		const envH = BALLOON_HALF.length;
		const c = makeCanvas(BALLOON_W, envH + 6);
		const ctx = c.getContext('2d')!;
		ctx.imageSmoothingEnabled = false;
		const W1 = '#ffffff';
		const W2 = '#c4ccd4';
		const W3 = '#e2e7ec';
		BALLOON_HALF.forEach((h, y) => {
			const a = cx - h;
			const b = cx + h;
			for (let x = a; x <= b; x++) {
				let col = W1;
				if (x === a || x === b) col = W2;
				else if (BALLOON_SEAMS.includes(x)) col = W2;
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
		return mkTex(c);
	}

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

	// Reserve the (empty) balloon container in z-order during first paint.
	function createBalloonLayer() {
		if (!camera) return;
		balloonLayer = new Container();
		balloonLayer.eventMode = 'none';
		camera.addChild(balloonLayer);
	}
	function fillBalloon() {
		if (!geo || !balloonLayer) return;
		balloonTex = buildBalloonTex();
		balloonBounds = computeLandBBox();
		balloonNoiseX = makeNoise(fnv1a('balloon-x'));
		balloonNoiseY = makeNoise(fnv1a('balloon-y'));
		const b = balloonBounds;
		const sp = new Sprite(balloonTex);
		sp.anchor.set(0.5, 1);
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

		if (titleBrandGroup && balloonTex) {
			titleBalloon = new Sprite(balloonTex);
			titleBalloon.anchor.set(0.5, 0.5);
			titleBalloon.tint = 0xffffff;
			titleBrandGroup.addChild(titleBalloon);
		}
	}

	const WAVE_CURVE = [1, 0, 0, 1, 2, 2, 1, 1];
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

	// Reserve the (empty) wave container in z-order during first paint; the sprites
	// themselves are generated afterwards in fillWaves.
	function createWaveLayer() {
		if (!camera) return;
		waveLayer = new Container();
		waveLayer.eventMode = 'none';
		camera.addChild(waveLayer);
	}
	function fillWaves() {
		if (!geo || !waveLayer) return;
		waveTex = buildWaveTex();
		waves = [];
		const g = geo;
		const gc = g.groundScale;
		const r = mulberry32(fnv1a('waves'));

		const marginX = Math.round(g.cols * 0.7);
		const cand: { x: number; y: number }[] = [];
		for (let y = Math.ceil(g.rows * 0.5); y < g.rows; y++) {
			for (let x = -marginX; x < g.cols + marginX; x++) {
				if (x >= 0 && x < g.cols) {
					const idx = y * g.cols + x;
					if (g.land[idx] || g.shallow[idx]) continue;
				}
				const p = 0.0022 * (y > g.rows * 0.62 ? 1.7 : 1);
				if (r() < p) cand.push({ x, y });
			}
		}
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
		// The off-mode texture may still be loading; keep the stale one until the
		// idle load lands and calls back in here.
		const t = groundTex[skyMode(sky.timeIndex)];
		if (t) groundSprite.texture = t;
	}

	function binCover(b: Bin, key: 'h' | 'm' | 'l'): number {
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
							l: Math.round(binCover(b, 'l'))
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
				if (!sp) break;
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
		if (userPulse && userOnMap && !reduced) {
			const g = (Math.sin(performance.now() / 500) + 1) * 0.5; // 0..1
			userPulse.scale.set(1 + g * 0.7);
			userPulse.alpha = 1 - g;
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

			const F = 0.00006;
			let vx = balloonNoiseX(balloon.phase * F) * 2 - 1;
			let vy = balloonNoiseY(balloon.phase * F * 1.3) * 2 - 1;
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
			pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
			c.setPointerCapture(e.pointerId);
			userMoved = true;
			if (pointers.size === 1) {
				dragging = true;
				moved = false;
				last = { x: e.clientX, y: e.clientY };
			} else if (pointers.size === 2) {
				dragging = false;
				moved = true;
				pinch = pinchGeom();
			}
		});
		c.addEventListener('pointermove', (e) => {
			if (showDebug) {
				const w = clientToWorld(e.clientX, e.clientY);
				dbg.wx = Math.round(w.ox);
				dbg.wy = Math.round(w.oy);
			}
			if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
			if (pinch && pointers.size >= 2) {
				const g = pinchGeom();
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
			const wasTap = dragging && !moved && pointers.size === 1;
			pointers.delete(e.pointerId);
			if (pointers.size < 2) pinch = null;
			if (pointers.size === 1) {
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
		const narrow = narrowLayout();
		// On mobile/narrow layouts don't let the map shrink below its contain size
		// (previously fit * 0.4 zoomed way out into empty gutters), and give extra
		// zoom-in headroom so the finest city-label tiers are actually reachable.
		const minZoom = fit * (narrow ? 1 : 0.9);
		const maxZoom = fit * (narrow ? 10 : 7);
		zoom = Math.max(minZoom, Math.min(maxZoom, zoom * factor));
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
			destroyed = true;
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
	$effect(() => {
		void userGeo.loc;
		if (app) updateUserMarker();
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
