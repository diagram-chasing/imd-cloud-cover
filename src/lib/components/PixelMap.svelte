<script lang="ts" module>
	export interface HoverInfo {
		code: string;
		clientX: number;
		clientY: number;
		members: number;
		agg?: { h: number; m: number; l: number; r?: number };
	}
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import {
		Application,
		CanvasTextMetrics,
		Container,
		Graphics,
		Sprite,
		type Texture,
		type Ticker
	} from 'pixi.js';
	import type { FeatureCollection } from 'geojson';
	import type { StationsManifest } from '$lib/types';
	import { CELL, SKY, skyMode, skyPhase, UI, type BandKey } from '$lib/theme';
	import { prettyDate } from '$lib/format';
	import {
		buildGeo,
		buildPlaces as buildGeoPlaces,
		landBBox,
		loadGroundMask,
		type Geo
	} from '$lib/map/geo';
	import groundDayUrl from '$lib/assets/ground/ground-day.png';
	import groundNightUrl from '$lib/assets/ground/ground-night.png';
	import groundMaskUrl from '$lib/assets/ground/ground-mask.png';
	import { MapCamera, PAD, WORLD_W } from '$lib/map/camera';
	import { BIN0, FINE_LOD, LOD_STEPS, buildLod, lodForZoom, type Bin, type Lod } from '$lib/map/lod';
	import { CloudField, MARK_CELL, TOWER_GAP, BAND_KEYS } from '$lib/map/clouds';
	import { TitleOverlay, buildLandFrac, type LandFrac } from '$lib/map/title';
	import { BalloonLayer } from '$lib/map/balloon';
	import { WaveLayer } from '$lib/map/waves';
	import { PlacesLayer } from '$lib/map/places';
	import { YouMarker } from '$lib/map/you';
	import { loadTex } from '$lib/map/textures';
	import { buildQuadtree, nearest } from '$lib/map/hit';
	import { createFlights, type FlightEngine } from '$lib/map/flights';
	import { sky } from '$lib/state/sky.svelte';
	import { userGeo } from '$lib/state/geo.svelte';
	import { click, tap } from '$lib/feedback';

	interface Props {
		india: FeatureCollection;
		places?: FeatureCollection;
		manifest: StationsManifest;
		values: Record<string, { h: number; m: number; l: number; r?: number }>;
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

	const GHOST_ALPHA = 0.4;
	// warm golden multiply-tint on the day ground during dawn/dusk (twilight phase)
	const TWILIGHT_TINT = 0xecb884;
	// Fly-to used by search
	const FOCUS_ZOOM_RATIO = 5;

	let host = $state<HTMLDivElement>();
	let vw = 1;
	let vh = 1;

	let showDebug = $state(false);
	let dbg = $state({ panX: 0, panY: 0, zoom: 1, wx: 0, wy: 0 });
	let dbgForm = $state({ panX: 0, panY: 0, zoom: 1 });
	function applyDebug() {
		userMoved = true;
		cam.jumpTo(dbgForm);
		applyCamera();
	}

	let app: Application | null = null;
	let geo: Geo | null = null;
	let world: Container | null = null;
	let groundSprite: Sprite | null = null;
	let groundTex: Partial<Record<'day' | 'night', Texture>> | null = null;
	let skyGfx: Graphics | null = null;
	let hoverGfx: Graphics | null = null;
	let selGfx: Graphics | null = null;
	let you: YouMarker | null = null;

	const cam = new MapCamera();
	const field = new CloudField();
	let title: TitleOverlay | null = null;
	let landFrac: LandFrac | null = null;
	let balloon: BalloonLayer | null = null;
	let waves: WaveLayer | null = null;
	let placeLabels: PlacesLayer | null = null;
	let flightLayer: Container | null = null;
	let flights: FlightEngine | null = null;

	let bins: Bin[] = [];
	let binByCode = new Map<string, Bin>();
	let lods: Lod[] = [];
	let lodIndex = -1;
	let maxBins = 0;
	let finestBuilt = false;
	let destroyed = false;
	let userMoved = false;
	let quad: ReturnType<typeof buildQuadtree> | null = null;
	const alphaTarget: Record<BandKey, number> = { low: 1, middle: 1, high: 1 };

	let fontsReady = false;
	const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

	const onIdle = (cb: () => void, timeout = 2000) => {
		const w = window as unknown as {
			requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void;
		};
		if (w.requestIdleCallback) w.requestIdleCallback(cb, { timeout });
		else setTimeout(cb, 1);
	};

	// Day/night follows the clock only in the hourly 'today' view. The week/month
	// scrubbers show daily means with no single hour, so holding a fixed timeIndex
	// there would paint the whole span as night — force daylight instead.
	const dayLocked = () => sky.view !== 'today';
	const effMode = () => (dayLocked() ? 'day' : skyMode(sky.timeIndex));
	const effPhase = () => (dayLocked() ? 'day' : skyPhase(sky.timeIndex));
	const night = () => effMode() === 'night';

	// --- camera application -------------------------------------------------

	function applyCamera() {
		if (!world) return;
		world.scale.set(cam.zoom);
		world.position.set(-cam.panX * cam.zoom, -cam.panY * cam.zoom);
		if (lods.length) applyLod(lodForZoom(cam.zoom / cam.containZoom(), lodIndex));
		updateScales();
		placeLabels?.declutter(camView());
		you?.onCamera(cam.zoomRatio());
		title?.fade(cam.zoomRatio(), night());
		emitLayout();
		if (showDebug) {
			dbg.panX = cam.panX;
			dbg.panY = cam.panY;
			dbg.zoom = cam.zoom;
		}
	}

	function camView() {
		return { zoomRatio: cam.zoomRatio(), panX: cam.panX, panY: cam.panY, zoom: cam.zoom, vw, vh };
	}

	function fitCamera() {
		if (!geo) return;
		cam.fit();
		applyCamera();
	}

	function emitLayout() {
		if (!geo) return;
		onlayout?.({
			gutter: cam.screenGutter(),
			zoomRatio: cam.zoomRatio(),
			view: cam.view(),
			world: { w: geo.worldW, h: geo.worldH }
		});
	}

	function updateScales() {
		you?.rescale(cam.zoom);
		placeLabels?.rescale(cam.zoom);
	}

	// --- LOD ----------------------------------------------------------------

	// coarse LODs only up front; finest LOD is a lazy placeholder until zoom-in
	function buildLods() {
		lods = LOD_STEPS.map(({ bin }, i) =>
			i < FINE_LOD ? buildLod(geo!, bin) : (null as unknown as Lod)
		);
		maxBins = Math.max(...lods.slice(0, FINE_LOD).map((l) => l.bins.length));
	}
	function ensureFineLod() {
		if (finestBuilt) return;
		finestBuilt = true;
		lods[FINE_LOD] = buildLod(geo!, LOD_STEPS[FINE_LOD].bin);
		field.grow(lods[FINE_LOD].bins.length);
	}

	function hitR(): number {
		return (lodIndex < 0 ? BIN0 : lods[lodIndex].bin) * 0.7;
	}

	function applyLod(i: number) {
		// Entering the finest LOD builds it (and grows the pools) on first demand.
		if (i === FINE_LOD && !finestBuilt) ensureFineLod();
		if (i === lodIndex) return;
		lodIndex = i;
		const lod = lods[i];
		bins = lod.bins;
		binByCode = new Map(bins.map((b) => [b.code, b]));
		field.place(bins, lod.scale);
		quad = buildQuadtree(lod.points);
		updateClouds();
		drawSelected();
		drawHover();
	}

	// --- per-bin values -----------------------------------------------------

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

	function binRain(b: Bin): number {
		let s = 0;
		let n = 0;
		for (const i of b.members) {
			const v = values[geo!.stations[i].code];
			if (v) {
				s += v.r ?? 0;
				n++;
			}
		}
		return n ? s / n : 0;
	}

	let driftTick = 0;
	function updateClouds() {
		if (!geo) return;
		// Rain rides with the low band: hide it when the user mutes rain, and when a
		// non-low band is soloed (streaks would fall from ghosted low clouds).
		const showRain = sky.rainOn && (sky.focusBand === null || sky.focusBand === 'low');
		field.update(bins, binCover, binRain, driftTick, showRain);
	}

	function retargetAlphas() {
		for (const band of BAND_KEYS)
			alphaTarget[band] = sky.focusBand === null || sky.focusBand === band ? 1 : GHOST_ALPHA;
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
							r: Math.round(binRain(b) * 10) / 10
						}
					: undefined
		};
	}

	// --- hover / selection boxes -------------------------------------------

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

	// --- sky / ground / title ----------------------------------------------

	function drawSky() {
		if (!skyGfx) return;
		const pal = SKY[effPhase()];
		skyGfx.clear();
		skyGfx.rect(0, 0, vw, vh).fill({ color: pal.top });
	}

	function updateGround() {
		if (!groundSprite || !groundTex) return;
		// off-mode texture may still be loading - keep stale until idle load lands
		const t = groundTex[effMode()];
		if (t) groundSprite.texture = t;
		// dawn/dusk reuse the day texture (skyMode is 'day' at steps 2 & 6) warmed
		// toward golden hour, giving a real intermediate between day and night
		groundSprite.tint = effPhase() === 'twilight' ? TWILIGHT_TINT : 0xffffff;
	}

	function metaText(): string {
		const time =
			sky.view === 'today'
				? `As of ${String(sky.timeIndex * 3).padStart(2, '0')}:00 IST`
				: 'DAILY MEAN';
		return [prettyDate(date), time].filter(Boolean).join('  ·  ');
	}

	function drawTitle() {
		if (!title || !geo || !landFrac) return;
		title.layout({
			vw,
			vh,
			narrow: cam.narrowLayout(),
			// score the live camera rect: fitCamera shifts the map into a gutter on
			// wide layouts, and placement must see exactly what's on screen
			view: cam.view(),
			landFrac,
			metaText: metaText()
		});
		title.fade(cam.zoomRatio(), night());
	}

	// --- ambient layers -----------------------------------------------------

	function styleAmbient() {
		const mode = effMode();
		flights?.style(mode === 'night');
		balloon?.style(mode === 'night');
		you?.style(mode === 'night');
		field.setShadowMode(mode);
		field.setRainMode(effPhase());
		waves?.style(mode);
	}

	// reserve z-order slot above the cloud bands; fillFlights populates after first frame
	function createFlightLayer() {
		if (!world) return;
		flightLayer = new Container();
		flightLayer.eventMode = 'none';
		world.addChild(flightLayer);
	}
	function fillFlights() {
		if (!geo || !flightLayer) return;
		flights = createFlights({
			parent: flightLayer,
			project: (lon, lat) => geo!.project(lon, lat),
			worldW: geo.worldW,
			worldH: geo.worldH,
			reduced
		});
	}

	function buildPlaces() {
		if (destroyed || !app || !fontsReady || !geo || !placeLabels || placeLabels.built) return;
		placeLabels.fill(geo.places, night());
		updateScales();
		placeLabels.declutter(camView());
	}

	// `places` is deferred: it usually arrives after init() has already built geo with an
	// empty places array. Project the labels into the existing geo and (re)build the markers.
	function syncPlaces() {
		if (!geo || !places || geo.places.length || placeLabels?.built) return;
		geo.places = buildGeoPlaces(places, geo.project);
		buildPlaces();
	}

	// Re-measure text once the web font resolves: PIXI caches the mono-fallback metrics
	// under the real font's key, so purge them and force a re-layout. Idempotent.
	function refreshFonts() {
		if (destroyed || !app) return;
		CanvasTextMetrics.clearMetrics();
		title?.invalidateFonts();
		you?.refreshFont();
		drawTitle();
		buildPlaces();
	}

	function markFontsReady() {
		if (fontsReady || destroyed) return;
		fontsReady = true;
		refreshFonts();
	}

	// --- "you are here" marker ----------------------------------------------

	// pixel marker at IP location; hidden when off-map
	function updateUserMarker() {
		if (!you || !geo) return;
		const loc = userGeo.loc;
		const p = loc ? geo.project(loc.lng, loc.lat) : null;
		if (!p || p[0] < -PAD || p[0] > geo.worldW + PAD || p[1] < -PAD || p[1] > geo.worldH + PAD) {
			you.hide();
			return;
		}
		you.show(p[0], p[1]);
		you.rescale(cam.zoom);
		you.onCamera(cam.zoomRatio());
	}

	// --- init ---------------------------------------------------------------

	async function init() {
		if (!host) return;

		const fontLoad = Promise.allSettled([
			document.fonts.load("400 10px 'Ships Whistle'"),
			document.fonts.load("700 10px 'Ships Whistle'")
		]);
		// Paint within 2.5s even if the font is slow, but re-measure whenever it truly
		// lands — a font arriving after the timeout would otherwise stay mono until reload.
		Promise.race([fontLoad, new Promise((r) => setTimeout(r, 2500))]).then(markFontsReady);
		fontLoad.then(() => {
			if (!destroyed) refreshFonts();
		});

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

		const mode = untrack(() => effMode());
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
		landFrac = buildLandFrac(geo);

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

		world = new Container();
		app.stage.addChild(world);

		groundSprite = new Sprite(groundTex?.[untrack(() => effMode())] ?? groundNow);
		groundSprite.scale.set(geo.groundScale);
		world.addChild(groundSprite);

		// reserve z-order now; ambient layers populated after first frame
		field.attachShadow(world);
		waves = new WaveLayer(world);
		title = new TitleOverlay(world);
		field.attachRain(world);
		field.attachBands(world);
		createFlightLayer();
		balloon = new BalloonLayer(world);
		placeLabels = new PlacesLayer(world);

		selGfx = new Graphics();
		world.addChild(selGfx);
		hoverGfx = new Graphics();
		world.addChild(hoverGfx);
		you = new YouMarker(world);

		field.buildTextures(MARK_CELL);
		field.grow(maxBins);
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

		await nextFrame();
		if (destroyed) return;
		waves.fill(geo);
		balloon.fill(landBBox(geo));
		if (balloon.texture) title.setBalloon(balloon.texture);
		fillFlights();
		drawTitle(); // re-seat the title balloon in the brand row
		styleAmbient();
		onIdle(() => {
			if (destroyed) return;
			buildPlaces();
		});
	}

	// --- frame tick ----------------------------------------------------------

	let lastDrift = 0;
	let reduced = false;
	function tick(t: Ticker) {
		if (cam.tick(t.deltaMS)) applyCamera();
		field.alphaTick(t.deltaMS, alphaTarget, reduced);
		if (!reduced) title?.float(performance.now());
		you?.tick(t.deltaMS, reduced);
		// Planes keep flying across every view (today / week / month) — they're a
		// living-map motif, not a "right now" one. Only reduced-motion stills them.
		if (!reduced) flights?.tick(t.deltaMS);
		balloon?.updateBubble(cam.zoom);
		if (reduced || sky.view !== 'today') return;
		const now = performance.now();
		if (now - lastDrift > 1200) {
			lastDrift = now;
			driftTick = (driftTick + 1) % 4;
			field.drift(driftTick, bins, lodIndex < 0 ? 1 : lods[lodIndex].scale);
			waves?.drift(driftTick);
		}
		balloon?.wander(t.deltaMS);
	}

	// --- pointer interaction -------------------------------------------------

	function clientToWorld(clientX: number, clientY: number) {
		const rect = app!.canvas.getBoundingClientRect();
		return cam.toWorld(clientX - rect.left, clientY - rect.top);
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

	function zoomAtClient(clientX: number, clientY: number, factor: number) {
		const rect = app!.canvas.getBoundingClientRect();
		cam.zoomAt(clientX - rect.left, clientY - rect.top, factor);
		applyCamera();
		if (sky.selectedCode) sky.selectedCode = null;
	}

	function bindPointer() {
		const c = app!.canvas;
		c.addEventListener('pointerdown', (e) => {
			pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
			c.setPointerCapture(e.pointerId);
			userMoved = true;
			cam.cancelTween();
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
				cam.move(g.cx - pinch.cx, g.cy - pinch.cy);
				zoomAtClient(g.cx, g.cy, g.dist / pinch.dist);
				pinch = g;
				return;
			}
			if (dragging) {
				if (Math.abs(e.clientX - last.x) + Math.abs(e.clientY - last.y) > 3) moved = true;
				cam.panBy(e.clientX - last.x, e.clientY - last.y);
				last = { x: e.clientX, y: e.clientY };
				applyCamera();
				if (moved && sky.selectedCode) sky.selectedCode = null;
				if (enableTooltip && sky.hoverCode)
					onhover?.(hoverInfo(sky.hoverCode, e.clientX, e.clientY));
				return;
			}
			const { ox, oy } = clientToWorld(e.clientX, e.clientY);
			balloon?.notifyCursor(ox, oy);
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
				if (balloon?.hit(ox, oy)) {
					balloon.poke(cam.zoom);
					click('select');
					tap('light');
					return;
				}
				const p = quad ? nearest(quad, ox, oy, hitR()) : null;
				if (p) {
					sky.selectedCode = p.code;
					click('select');
					tap('light');
					const rect = app!.canvas.getBoundingClientRect();
					const s = cam.toScreen(p.x, p.y);
					onselect?.(p.code, { x: rect.left + s.x, y: rect.top + s.y });
				}
			}
		};
		c.addEventListener('pointerup', endPointer);
		c.addEventListener('pointercancel', endPointer);
		c.addEventListener('pointerleave', () => {
			sky.hoverCode = null;
			balloon?.clearCursor();
			drawHover();
			onhover?.(null);
		});
		c.addEventListener(
			'wheel',
			(e) => {
				e.preventDefault();
				userMoved = true;
				zoomAtClient(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
			},
			{ passive: false }
		);
	}

	// --- public API -----------------------------------------------------------

	export function focusStation(code: string): { x: number; y: number } | null {
		if (!geo || !app) return null;
		const st = geo.stations.find((s) => s.code === code);
		if (!st) return null;
		userMoved = true;
		sky.selectedCode = code;
		const target = cam.toCenter(st.rpx, st.rpy, cam.containZoom() * FOCUS_ZOOM_RATIO);
		if (reduced) {
			cam.jumpTo(target);
			applyCamera();
		} else {
			cam.flyTo(target, 620);
		}
		const rect = app.canvas.getBoundingClientRect();
		return {
			x: rect.left + (st.rpx - target.panX) * target.zoom,
			y: rect.top + (st.rpy - target.panY) * target.zoom
		};
	}
	function zoomButton(dir: 1 | -1) {
		userMoved = true;
		const rect = app?.canvas.getBoundingClientRect();
		zoomAtClient((rect?.left ?? 0) + vw / 2, (rect?.top ?? 0) + vh / 2, dir > 0 ? 1.3 : 1 / 1.3);
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

	// --- lifecycle / reactivity ----------------------------------------------

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
			cam.setViewport(vw, vh);
			drawSky();
			// fit first so drawTitle scores the real on-screen view (fitCamera sets pan/zoom)
			if (!userMoved) fitCamera();
			else emitLayout();
			drawTitle();
		});
		ro.observe(host);
		const onkey = (e: KeyboardEvent) => {
			const el = e.target as HTMLElement | null;
			if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
			if (e.key === 'd' || e.key === 'D') {
				showDebug = !showDebug;
				if (showDebug) {
					dbgForm.panX = Math.round(cam.panX);
					dbgForm.panY = Math.round(cam.panY);
					dbgForm.zoom = +cam.zoom.toFixed(4);
					dbg.panX = cam.panX;
					dbg.panY = cam.panY;
					dbg.zoom = cam.zoom;
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
			flights?.destroy();
			flights = null;
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
		void sky.rainOn;
		retargetAlphas();
		if (app) updateClouds();
	});
	$effect(() => {
		void sky.timeIndex;
		// view also drives day/night: week/month lock the map to daylight (see effMode)
		void sky.view;
		if (app) {
			updateGround();
			drawSky();
			title?.setMeta(metaText());
			title?.fade(cam.zoomRatio(), night());
			placeLabels?.style(night());
			styleAmbient();
			drawHover();
		}
	});
	$effect(() => {
		void date;
		if (app) title?.setMeta(metaText());
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
	// deferred `places` load lands after init() — project it in and build the labels
	$effect(() => {
		void places;
		if (app) syncPlaces();
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
