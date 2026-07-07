<script lang="ts">
	import { Application, Container, Sprite, Texture, Graphics, Text, type Ticker } from 'pixi.js';
	import type { FeatureCollection } from 'geojson';
	import type { StationsManifest } from '$lib/types';
	import { CELL, SKY, skyMode, coverTier, UI, type BandKey } from '$lib/theme';
	import { buildGeo, type Geo } from '$lib/map/geo';
	import { buildMarkAtlas, MARK_VARIANTS } from '$lib/map/sprites';
	import { buildQuadtree, nearest, type StationPoint } from '$lib/map/hit';
	import { fnv1a, jitter, mulberry32 } from '$lib/map/hash';
	import { sky } from '$lib/state/sky.svelte';
	import { Button } from '$lib/components/ui/button';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { PlusSignIcon, MinusSignIcon, Maximize01Icon } from '@hugeicons/core-free-icons';

	interface Props {
		india: FeatureCollection;
		urban?: FeatureCollection;
		rivers?: FeatureCollection;
		places?: FeatureCollection;
		manifest: StationsManifest;
		values: Record<string, { h: number; m: number; l: number }>;
		persistence?: Record<string, number>;
		enableTooltip?: boolean;
		onhover?: (info: { code: string; clientX: number; clientY: number } | null) => void;
		onselect?: (code: string, at?: { x: number; y: number }) => void;
	}
	let {
		india,
		urban,
		rivers,
		places,
		manifest,
		values,
		enableTooltip = true,
		onhover,
		onselect
	}: Props = $props();

	const WORLD_W = 1024;
	const PAD = 4;
	const MARK_CELL = 3; // px per logical cell of a tower mark
	// Two constraints keep towers readable (glyphs cap at 3 rows tall):
	//   1. bands separate WITHIN a tower  → TOWER_GAP must clear a mark's height
	//   2. towers separate FROM EACH OTHER → the bin must clear a whole tower's height
	// Break either (e.g. TOWER_GAP > bin) and the three bands overlap into blocks.
	const TOWER_GAP = MARK_CELL * 3.5; // centre-to-centre px between adjacent bands
	// A tower is TOWER_GAP*2 + MARK_CELL*3 = 30px tall. BIN0 is the aggregation grid at
	// fit-zoom, set a touch tighter than a full tower so the overview already packs more
	// stations; the per-level marks are scaled by bin/BIN0 so towerHeight tracks the bin
	// at every level and whole towers still never overlap (see LODS + applyLod).
	const BIN0 = 24; // base aggregation grid spacing (px)
	// Level-of-detail ladder: zooming in subdivides the bin grid toward one bin per
	// station, so every station eventually becomes its own tower. `enter` is the zoom
	// multiple of the fit zoom at which the level activates; `bin: null` = per-station.
	const LODS: { bin: number | null; enter: number }[] = [
		{ bin: BIN0, enter: 0 }, // 0: overview
		{ bin: 16, enter: 1.7 }, // 1
		{ bin: 11, enter: 2.9 }, // 2
		{ bin: null, enter: 4.6 } // 3: per-station (reveals near LABEL_ZOOM = 4.5)
	];
	const LOD_DOWN_FACTOR = 0.9; // deadband so a level boundary doesn't thrash on jitter
	const GHOST_ALPHA = 0.1; // non-focused bands while one band is isolated
	const LABEL_ZOOM = 4.5; // show city labels only past this multiple of the fit zoom (max zoom is 7x)
	// Vertical offset of each band's mark from the bin centre, in px.
	const BAND_OFFSET: Record<BandKey, number> = {
		high: -TOWER_GAP,
		middle: 0,
		low: TOWER_GAP
	};
	const BAND_KEYS: BandKey[] = ['low', 'middle', 'high'];
	const VAL_KEY: Record<BandKey, 'h' | 'm' | 'l'> = { high: 'h', middle: 'm', low: 'l' };

	// Ambient decoration: a handful of slow planes with fading contrails wander the
	// sky at varied headings, gently curving so their trails criss-cross. Purely for
	// a calm vibe — no data, gated behind the same reduced-motion / today-view check
	// as the cloud drift (see tick).
	const PLANE_COUNT = 5;
	const TRAIL_LEN = 44; // px length of a contrail strip (world space)
	// px per ms so a full-world crossing lands around 60–90s (worldW ~ 1024).
	const PLANE_SPEED_MIN = 1024 / 90000;
	const PLANE_SPEED_MAX = 1024 / 60000;

	// Pixel-boxed styling shared by the zoom/reset controls.
	const ctlClass =
		'size-8 rounded-none border-2 border-[var(--ink)] bg-[var(--paper)] text-[var(--ink)] shadow-none hover:bg-[var(--cloud-block)] hover:text-[var(--ink)]';

	interface Bin {
		px: number;
		py: number;
		members: number[];
		code: string;
		variant: number; // stable per-station shape pick, so the field isn't uniform
	}
	// One precomputed level of detail. `scale` shrinks the marks + band offsets so
	// towerHeight tracks `bin`; `points` is the hit index for the level.
	interface Lod {
		bin: number; // resolved bin size (per-station level uses its glyph footprint)
		scale: number; // sprite/offset scale = bin / BIN0
		bins: Bin[];
		points: StationPoint[];
	}

	let host = $state<HTMLDivElement>();
	let vw = $state(1);
	let vh = $state(1);

	const STORY_TITLE = 'Reading The Clouds';

	let app: Application | null = null;
	let geo: Geo | null = null;
	let camera: Container | null = null;
	let groundSprite: Sprite | null = null;
	let skyGfx: Graphics | null = null;
	let titleText: Text | null = null;
	let hoverGfx: Graphics | null = null;
	let selGfx: Graphics | null = null;
	let placesLayer: Container | null = null;
	let placeMarkers: Container[] = [];
	let placeLabels: Text[] = [];
	let placeDots: Graphics[] = [];
	let placePlates: Graphics[] = [];
	let bins: Bin[] = []; // alias of lods[lodIndex].bins — the currently active level
	let lods: Lod[] = [];
	let lodIndex = -1; // -1 forces the first applyLod() to run
	let maxBins = 0; // finest-level bin count (== station count); sizes the shared pool
	let planeLayer: Container | null = null;
	interface Plane {
		c: Container;
		x: number;
		y: number;
		heading: number; // radians; travel direction (0 = +x)
		speed: number; // px per ms
		curvePhase: number;
		curveSpeed: number; // curvePhase advance per ms
		curveAmp: number; // turn rate amplitude (rad per ms)
	}
	let planes: Plane[] = [];
	let planeRand: (() => number) | null = null;
	let planeTex: Texture | null = null;
	let trailTex: Texture | null = null;
	const pool: Record<BandKey, Sprite[]> = { low: [], middle: [], high: [] };
	let layers: Record<BandKey, Container> | null = null;
	const alphaTarget: Record<BandKey, number> = { low: 1, middle: 1, high: 1 };
	// cloudTex[band][tier][variant]
	let cloudTex: Record<BandKey, Texture[][]> = { low: [], middle: [], high: [] };
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
	function fitCamera() {
		if (!geo) return;
		const b = worldBBox();
		zoom = containZoom();
		panX = b.minX - (vw / zoom - (b.maxX - b.minX)) / 2;
		panY = b.minY - (vh / zoom - (b.maxY - b.minY)) / 2;
		applyCamera();
	}
	function applyCamera() {
		if (!camera) return;
		camera.scale.set(zoom);
		camera.position.set(-panX * zoom, -panY * zoom);
		// Swap the LOD level when the zoom crosses a threshold. Pans keep the same zoom,
		// so lodForZoom returns the current index and applyLod early-returns — cheap.
		if (lods.length) applyLod(lodForZoom());
		updatePlacesScale();
		updateLabelVis();
	}

	// City markers live under the camera so they pan/zoom in place, but each is
	// counter-scaled by 1/zoom so its label stays a constant SCREEN size (they
	// spread apart on zoom-in rather than ballooning) — standard map-label behaviour.
	function updatePlacesScale() {
		if (!placeMarkers.length) return;
		const s = 1 / zoom;
		for (const m of placeMarkers) m.scale.set(s);
	}

	// City markers (dot + label + plate) are noise at map-fit scale, so hide the
	// whole places layer until the view is zoomed well in. The threshold is a
	// multiple of the fit zoom, so it holds across viewport sizes.
	function updateLabelVis() {
		if (!placesLayer) return;
		placesLayer.visible = zoom >= containZoom() * LABEL_ZOOM;
	}

	function mkTex(canvas: HTMLCanvasElement | OffscreenCanvas): Texture {
		const t = Texture.from(canvas as HTMLCanvasElement);
		t.source.scaleMode = 'nearest';
		return t;
	}

	// Aggregate stations onto a `binSize` grid (using raw, unsnapped projected coords so
	// the LOD grid — not the legacy CELL snap — drives aggregation). `binSize === null`
	// gives one bin per station: the finest level where every station is its own tower.
	function buildBins(binSize: number | null): Bin[] {
		const g = geo!;
		if (binSize === null) {
			// Per-station: nudge each off its raw point (plus a tiny extra spread so
			// coincident stations don't stack exactly), keyed off the code so it's stable.
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
		// representative station = nearest to bin centre
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
			// Break the grid: nudge each tower a few px and pick a stable shape
			// variant, both keyed off the station so the render stays deterministic.
			b.px += jitter(b.code, 'jx', 3);
			b.py += jitter(b.code, 'jy', 2);
			b.variant = fnv1a(b.code) % MARK_VARIANTS;
		}
		// north-first so nearer (south) marks overdraw
		return [...map.values()].sort((a, b) => a.py - b.py);
	}

	// Precompute every LOD level once. Each level's marks scale by bin/BIN0, so a whole
	// tower always fits its bin. The per-station level has no grid, so we give it a
	// nominal bin (its scaled tower footprint) for hit-testing + box geometry.
	function buildLods() {
		lods = LODS.map(({ bin }) => {
			const resolved = bin ?? 9; // per-station nominal footprint (BIN0 * 0.375)
			const built = buildBins(bin);
			return {
				bin: resolved,
				scale: resolved / BIN0,
				bins: built,
				points: built.map((b) => ({ code: b.code, cellX: 0, cellY: 0, x: b.px, y: b.py }))
			};
		});
		maxBins = Math.max(...lods.map((l) => l.bins.length));
	}

	// Hover/select radius for the active level: >= bin/sqrt(2) so bins have no dead zones.
	function hitR(): number {
		return (lodIndex < 0 ? BIN0 : lods[lodIndex].bin) * 0.7;
	}

	// Active level for the current zoom, with hysteresis: only step DOWN a level once
	// the zoom drops below LOD_DOWN_FACTOR of that boundary, so a boundary doesn't thrash.
	function lodForZoom(): number {
		const r = zoom / containZoom();
		let L = 0;
		for (let i = 1; i < LODS.length; i++) if (r >= LODS[i].enter) L = i;
		if (L < lodIndex && r > LODS[lodIndex].enter * LOD_DOWN_FACTOR) L = lodIndex;
		return L;
	}

	// Switch the visible level: re-point `bins`, reposition/rescale the shared sprite
	// pool, and rebuild the hit index. Only runs on threshold crossings (applyCamera
	// early-returns via the index check on every pan). The pool was built in north-sort
	// index order and each level's bins are north-sorted, so bins[k] -> pool[band][k]
	// keeps southern towers overdrawing northern ones without any child reordering.
	function applyLod(i: number) {
		if (i === lodIndex || !layers) return;
		lodIndex = i;
		const lod = lods[i];
		bins = lod.bins;
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
		quad = buildQuadtree(lod.points);
		updateClouds();
		drawSelected();
		drawHover();
	}

	async function init() {
		if (!host) return;
		// Canvas text is baked once, so the label font must be ready before Pixi
		// draws it — otherwise it renders in the fallback and never refreshes.
		await document.fonts.load("10px 'Geist Pixel'").catch(() => {});
		const atlas = buildMarkAtlas(MARK_CELL);
		geo = buildGeo(india, manifest, WORLD_W, CELL, urban, places, rivers);
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

		groundSprite = new Sprite(mkTex(geo.renderGround(sky.timeIndex)));
		groundSprite.scale.set(geo.groundScale);
		camera.addChild(groundSprite);

		// Faint story title, anchored to the left of the world so it pans and
		// zooms with the map. Sits above the ground but under the cloud marks.
		titleText = new Text({
			text: STORY_TITLE,
			style: {
				fontFamily: "'Geist Pixel', monospace",
				fontWeight: '400',
				align: 'left',
				fill: 0xffffff,
				wordWrap: true,
				wordWrapWidth: 2
			}
		});
		titleText.anchor.set(1.2, 0.5);
		titleText.eventMode = 'none';
		camera.addChild(titleText);

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

		// One shared pool of maxBins sprites per band, added in index order and all
		// hidden. applyLod re-points/rescales bins[k] -> pool[band][k] on each level
		// change; the finest level uses every sprite, coarser levels hide the surplus.
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

		// Selected highlight sits under the hover box so hovering the selected
		// cell still reads. Both live in camera space so they track pan/zoom.
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
		// Re-frame once layout has settled (host size may arrive a frame late).
		requestAnimationFrame(() => {
			if (!userMoved) fitCamera();
		});
	}

	// Screen-space backdrop: one solid sky colour. Sits behind the camera, so the
	// transparent sea of the land sprite reveals it — blue by day, navy at night.
	function drawSky() {
		if (!skyGfx) return;
		const pal = SKY[skyMode(sky.timeIndex)];
		skyGfx.clear();
		skyGfx.rect(0, 0, vw, vh).fill({ color: pal.top });
	}

	// Faint story title stuck to the left of the world map. Coordinates are in
	// world space (child of camera), so it pans and zooms with the map.
	function drawTitle() {
		if (!titleText || !geo) return;
		const night = skyMode(sky.timeIndex) === 'night';
		// Size relative to the world so it scales sensibly; wraps into a stacked
		// column pinned near the left edge.
		const size = geo.worldH * 0.06;
		titleText.style.fontSize = size;
		titleText.style.lineHeight = size * 1.05;
		titleText.style.wordWrapWidth = geo.worldW * 0.3;
		// Night: pale ice over navy. Day: deep ink over blue. Both barely there.
		titleText.style.fill = night ? 0xcde6ff : 0x0b1d3a;
		titleText.alpha = night ? 0.12 : 0.09;
		titleText.position.set(geo.worldW * 0.02, geo.worldH / 2);
	}

	// Font size tier by population — a light hierarchy so the metros read first.
	function placeSize(pop: number): number {
		if (pop >= 8_000_000) return 11;
		if (pop >= 3_000_000) return 10;
		return 9;
	}

	// Reference layer: a limited set of major cities, each a dot + a Geist Pixel
	// label sitting on a knockout plate so it stays legible over the busy land and
	// clouds. Each city is its own container, pinned at the projected point and
	// counter-scaled per frame (see updatePlacesScale) so labels hold a constant
	// screen size instead of ballooning with zoom.
	function buildPlaces() {
		if (!geo || !camera) return;
		placesLayer = new Container();
		placesLayer.eventMode = 'none';
		camera.addChild(placesLayer);
		placeMarkers = [];
		placeLabels = [];
		placeDots = [];
		placePlates = [];
		const GAP = 5; // px between the dot and the label plate

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
					fontFamily: "'Geist Pixel', monospace",
					fontWeight: '400',
					fontSize: placeSize(p.pop),
					fill: 0xffffff,
					letterSpacing: 0.5
				},
				resolution: 4
			});
			label.anchor.set(0, 0.5);
			label.position.set(GAP, 0);

			// Plate drawn from the measured label bounds, added before the label so
			// the text sits on top. Recoloured per sky mode in stylePlaces.
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

	// Recolour city markers for the current sky mode: dark ink glyph on a pale
	// plate by day, flipped to pale ink on a dark plate at night. The plate is
	// what actually makes the labels readable over land + clouds.
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

	// --- Ambient decoration (wandering planes with contrails) ------------------

	function makeCanvas(w: number, h: number): HTMLCanvasElement {
		const c = document.createElement('canvas');
		c.width = w;
		c.height = h;
		return c;
	}

	// Small plane glyph pointing right (+x). The container is rotated to the plane's
	// heading, so the glyph always faces its travel direction. Anchored at its nose
	// so the contrail lines up behind it.
	function buildPlaneTex(): Texture {
		const px = 1;
		const c = makeCanvas(6 * px, 3 * px);
		const ctx = c.getContext('2d')!;
		ctx.imageSmoothingEnabled = false;
		ctx.fillStyle = '#ffffff';
		// fuselage
		ctx.fillRect(0, px, 6 * px, px);
		// wings / tail nibs
		ctx.fillRect(2 * px, 0, px, 3 * px);
		ctx.fillRect(px, 2 * px, px, px);
		return mkTex(c);
	}

	// Horizontal contrail strip whose alpha ramps 0 (tail) → full (head at the right
	// edge). Baked once; the sprite is anchored (1, 0.5) at the plane nose.
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

	function buildPlanes() {
		if (!geo || !camera) return;
		planeTex = buildPlaneTex();
		trailTex = buildTrailTex(TRAIL_LEN);
		planeLayer = new Container();
		planeLayer.eventMode = 'none';
		// Above the cloud bands so planes ride high in the sky.
		camera.addChild(planeLayer);
		planes = [];
		planeRand = mulberry32(fnv1a('planes'));
		for (let i = 0; i < PLANE_COUNT; i++) {
			const trail = new Sprite(trailTex);
			trail.anchor.set(1, 0.5); // head at the plane, fades toward the tail
			const body = new Sprite(planeTex);
			body.anchor.set(1, 0.5);
			const c = new Container();
			c.eventMode = 'none';
			c.addChild(trail);
			c.addChild(body);
			planeLayer.addChild(c);
			const p: Plane = {
				c,
				x: 0,
				y: 0,
				heading: 0,
				speed: 0,
				curvePhase: 0,
				curveSpeed: 0,
				curveAmp: 0
			};
			// Reduced motion never advances the tick, so scatter across the map only
			// when motion is allowed — otherwise park each off-edge, invisible.
			resetPlane(p, !reduced);
			planes.push(p);
		}
	}

	// (Re)seed a plane. `initial` scatters it anywhere on the map at a random heading
	// so the sky is already busy on load; otherwise it enters from a random edge
	// aimed inward, so the fleet keeps criss-crossing.
	function resetPlane(p: Plane, initial = false) {
		if (!geo || !planeRand) return;
		const r = planeRand;
		const g = geo;
		p.speed = PLANE_SPEED_MIN + r() * (PLANE_SPEED_MAX - PLANE_SPEED_MIN);
		// Gentle wander: a slow-varying turn so contrails curve rather than run
		// dead straight. Amplitude is tiny (a fraction of a degree per ms).
		p.curvePhase = r() * Math.PI * 2;
		p.curveSpeed = 0.0002 + r() * 0.0004;
		p.curveAmp = (0.4 + r() * 0.9) * 0.00002 * Math.PI;
		if (initial) {
			p.x = r() * g.worldW;
			p.y = r() * g.worldH;
			p.heading = r() * Math.PI * 2; // any direction
		} else {
			const m = TRAIL_LEN * 1.5;
			const edge = Math.floor(r() * 4);
			// Enter from an edge, heading roughly across the map with a wide spread
			// so paths fan out and intersect.
			if (edge === 0) {
				p.x = -m;
				p.y = r() * g.worldH;
				p.heading = 0;
			} else if (edge === 1) {
				p.x = g.worldW + m;
				p.y = r() * g.worldH;
				p.heading = Math.PI;
			} else if (edge === 2) {
				p.x = r() * g.worldW;
				p.y = -m;
				p.heading = Math.PI / 2;
			} else {
				p.x = r() * g.worldW;
				p.y = g.worldH + m;
				p.heading = -Math.PI / 2;
			}
			p.heading += (r() - 0.5) * (Math.PI * 0.55); // ±~50° spread
		}
		p.c.x = p.x;
		p.c.y = p.y;
		p.c.rotation = p.heading;
	}

	// Recolour contrails for day/night, mirroring stylePlaces.
	function styleAmbient() {
		const night = skyMode(sky.timeIndex) === 'night';
		const trailTint = night ? 0xcfe4ff : 0xffffff;
		for (const p of planes) {
			const [trail, body] = p.c.children as Sprite[];
			trail.tint = trailTint;
			body.tint = trailTint;
		}
	}

	function updateGround() {
		if (!groundSprite || !geo) return;
		const old = groundSprite.texture;
		groundSprite.texture = mkTex(geo.renderGround(sky.timeIndex));
		old.destroy(true);
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

	let driftTick = 0;
	function updateClouds() {
		// layers is set only once the sprite pools exist; values can arrive earlier.
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
	}

	// Isolation: the focused band stays at full alpha, the others become ghosts.
	function retargetAlphas() {
		for (const band of BAND_KEYS)
			alphaTarget[band] = sky.focusBand === null || sky.focusBand === band ? 1 : GHOST_ALPHA;
	}

	// Tower-framing box geometry for the active level — the marks (and their spacing)
	// shrink by the level scale, so the box must too. Returns null if no active level.
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
		// Frame the whole tower: from above the high mark to below the low mark.
		hoverGfx
			.rect(box.x, box.y, box.w, box.h)
			.stroke({ width: 2, color: night ? UI.focus : 0xffffff, alignment: 0.5 });
	}

	// Persistent box around the open station, so it's clear which cell the card
	// belongs to. Focus colour + faint fill distinguish it from the hover box.
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
		// Alpha tween for band isolation runs in every view (snap when reduced).
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
			// Subtle wisp: nudge the whole high layer a couple px so cirrus feels
			// alive without detaching the small marks from their towers. Scaled by the
			// active level so the nudge shrinks with the marks.
			if (layers) layers.high.x = driftTick * 2 * (lodIndex < 0 ? 1 : lods[lodIndex].scale);
		}
		// Slow planes: advance along a gently-curving heading; re-seed from a fresh
		// edge once fully off the map so trails keep criss-crossing.
		if (geo) {
			const m = TRAIL_LEN * 2;
			for (const p of planes) {
				p.curvePhase += p.curveSpeed * t.deltaMS;
				p.heading += Math.sin(p.curvePhase) * p.curveAmp * t.deltaMS;
				p.x += Math.cos(p.heading) * p.speed * t.deltaMS;
				p.y += Math.sin(p.heading) * p.speed * t.deltaMS;
				p.c.x = p.x;
				p.c.y = p.y;
				p.c.rotation = p.heading;
				if (p.x < -m || p.x > geo.worldW + m || p.y < -m || p.y > geo.worldH + m)
					resetPlane(p);
			}
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
				// Panning detaches the card from its cell — dismiss it.
				if (moved && sky.selectedCode) sky.selectedCode = null;
				// Persist the tooltip through the drag: keep whatever was hovered and
				// let it follow the cursor. The world-space hover box tracks the pan
				// on its own (it lives in camera space).
				if (enableTooltip && sky.hoverCode)
					onhover?.({ code: sky.hoverCode, clientX: e.clientX, clientY: e.clientY });
				return;
			}
			const { ox, oy } = clientToWorld(e.clientX, e.clientY);
			const p = quad ? nearest(quad, ox, oy, hitR()) : null;
			sky.hoverCode = p ? p.code : null;
			drawHover();
			if (enableTooltip)
				onhover?.(p ? { code: p.code, clientX: e.clientX, clientY: e.clientY } : null);
		});
		c.addEventListener('pointerup', (e) => {
			if (dragging && !moved) {
				const { ox, oy } = clientToWorld(e.clientX, e.clientY);
				const p = quad ? nearest(quad, ox, oy, hitR()) : null;
				if (p) {
					sky.selectedCode = p.code;
					// Anchor the card to the cell's screen centre (not the raw cursor)
					// so it visibly points at the tower it describes.
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
		// Zooming moves the cell out from under the card — dismiss it.
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
	function resetView() {
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
		if (app) updateClouds();
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
			drawTitle();
			stylePlaces();
			styleAmbient();
			drawHover();
		}
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

<div class="pixel-map" bind:this={host}>
	<div class="zoom-ctl">
		<Button
			variant="outline"
			size="icon"
			class={ctlClass}
			aria-label="Zoom in"
			onclick={() => zoomButton(1)}
		>
			<HugeiconsIcon icon={PlusSignIcon} strokeWidth={2.5} />
		</Button>
		<Button
			variant="outline"
			size="icon"
			class={ctlClass}
			aria-label="Zoom out"
			onclick={() => zoomButton(-1)}
		>
			<HugeiconsIcon icon={MinusSignIcon} strokeWidth={2.5} />
		</Button>
		<Button
			variant="outline"
			size="icon"
			class={ctlClass}
			aria-label="Reset view"
			onclick={resetView}
		>
			<HugeiconsIcon icon={Maximize01Icon} strokeWidth={2.5} />
		</Button>
	</div>
</div>

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
	.zoom-ctl {
		position: absolute;
		right: 12px;
		bottom: 12px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		z-index: 2;
	}
</style>
