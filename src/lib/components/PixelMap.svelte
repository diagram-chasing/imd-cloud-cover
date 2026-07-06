<script lang="ts">
	import { Application, Container, Sprite, Texture, Graphics, type Ticker } from 'pixi.js';
	import type { FeatureCollection } from 'geojson';
	import type { StationsManifest } from '$lib/types';
	import { CELL, SKY, SKY_BANDS, skyMode, coverTier, UI, type BandKey } from '$lib/theme';
	import { lerpHex } from '$lib/map/color';
	import { buildGeo, type Geo } from '$lib/map/geo';
	import { buildAtlas } from '$lib/map/sprites';
	import { buildQuadtree, nearest, type StationPoint } from '$lib/map/hit';
	import { sky } from '$lib/state/sky.svelte';

	interface Props {
		india: FeatureCollection;
		manifest: StationsManifest;
		values: Record<string, { h: number; m: number; l: number }>;
		persistence?: Record<string, number>;
		enableTooltip?: boolean;
		onhover?: (info: { code: string; clientX: number; clientY: number } | null) => void;
		onselect?: (code: string) => void;
	}
	let { india, manifest, values, enableTooltip = true, onhover, onselect }: Props = $props();

	// --- Flat map tunables (straight-down "acetate stack") ---
	const WORLD_W = 1024;
	const PAD = 24; // world-px breathing room around the map
	const BIN = 36; // aggregation grid spacing in projected px (keeps marks apart)
	const HIT_R = BIN * 0.75; // hover/select radius; must stay >= BIN/sqrt(2) so bins have no dead zones
	const GHOST_ALPHA = 0.15; // non-focused bands while one band is isolated
	// Offset-print nudge per band, in cells: bands stack in place but never
	// perfectly occlude, so the three patterns stay readable when overlaid.
	const BAND_NUDGE: Record<BandKey, { x: number; y: number }> = {
		low: { x: 0, y: 1 },
		middle: { x: -1, y: 0 },
		high: { x: 1, y: -2 }
	};
	const BAND_KEYS: BandKey[] = ['low', 'middle', 'high'];
	const VAL_KEY: Record<BandKey, 'h' | 'm' | 'l'> = { high: 'h', middle: 'm', low: 'l' };

	interface Bin {
		px: number;
		py: number;
		members: number[];
		code: string;
	}

	let host = $state<HTMLDivElement>();
	let vw = $state(1);
	let vh = $state(1);

	let app: Application | null = null;
	let geo: Geo | null = null;
	let camera: Container | null = null;
	let groundSprite: Sprite | null = null;
	let skyGfx: Graphics | null = null;
	let hoverGfx: Graphics | null = null;
	let bins: Bin[] = [];
	const pool: Record<BandKey, Sprite[]> = { low: [], middle: [], high: [] };
	let layers: Record<BandKey, Container> | null = null;
	const alphaTarget: Record<BandKey, number> = { low: 1, middle: 1, high: 1 };
	let cloudTex: Record<BandKey, Texture[]> = { low: [], middle: [], high: [] };
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
	}

	function mkTex(canvas: HTMLCanvasElement | OffscreenCanvas): Texture {
		const t = Texture.from(canvas as HTMLCanvasElement);
		t.source.scaleMode = 'nearest';
		return t;
	}

	function buildBins(): Bin[] {
		const g = geo!;
		const map = new Map<string, Bin>();
		g.stations.forEach((st, i) => {
			const bx = Math.floor(st.px / BIN);
			const by = Math.floor(st.py / BIN);
			const key = `${bx},${by}`;
			let b = map.get(key);
			if (!b) {
				b = { px: (bx + 0.5) * BIN, py: (by + 0.5) * BIN, members: [], code: st.code };
				map.set(key, b);
			}
			b.members.push(i);
		});
		// representative station = nearest to bin centre
		for (const b of map.values()) {
			let best = Infinity;
			for (const i of b.members) {
				const st = g.stations[i];
				const d = (st.px - b.px) ** 2 + (st.py - b.py) ** 2;
				if (d < best) {
					best = d;
					b.code = st.code;
				}
			}
		}
		// north-first so nearer (south) marks overdraw
		return [...map.values()].sort((a, b) => a.py - b.py);
	}

	async function init() {
		if (!host) return;
		const atlas = buildAtlas(CELL);
		geo = buildGeo(india, manifest, WORLD_W, CELL);
		bins = buildBins();

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
		groundSprite.scale.set(CELL);
		camera.addChild(groundSprite);

		cloudTex = { low: [], middle: [], high: [] };
		for (const band of BAND_KEYS) {
			for (let tier = 1; tier <= 4; tier++) {
				cloudTex[band][tier] = mkTex(atlas.get(band, tier as 1 | 2 | 3 | 4).canvas);
			}
		}

		const layerMap = {} as Record<BandKey, Container>;
		for (const band of BAND_KEYS) {
			const layer = new Container();
			camera.addChild(layer);
			layerMap[band] = layer;
			pool[band] = bins.map((b) => {
				const s = new Sprite(cloudTex[band][1]);
				s.anchor.set(0.5, 0.5);
				s.x = b.px + BAND_NUDGE[band].x * CELL;
				s.y = b.py + BAND_NUDGE[band].y * CELL;
				s.scale.set(1.4);
				s.visible = false;
				layer.addChild(s);
				return s;
			});
		}
		layers = layerMap;
		retargetAlphas();

		const points: StationPoint[] = bins.map((b) => ({
			code: b.code,
			cellX: 0,
			cellY: 0,
			x: b.px,
			y: b.py
		}));
		quad = buildQuadtree(points);

		hoverGfx = new Graphics();
		camera.addChild(hoverGfx);

		fitCamera();
		drawSky();
		updateClouds();
		bindPointer();
		app.ticker.add(tick);
		// Re-frame once layout has settled (host size may arrive a frame late).
		requestAnimationFrame(() => {
			if (!userMoved) fitCamera();
		});
	}

	function drawSky() {
		if (!skyGfx) return;
		const pal = SKY[skyMode(sky.timeIndex)];
		skyGfx.clear();
		const bandH = vh / SKY_BANDS;
		for (let i = 0; i < SKY_BANDS; i++) {
			skyGfx
				.rect(0, i * bandH, vw, bandH + 1)
				.fill(lerpHex(pal.top, pal.bottom, i / (SKY_BANDS - 1)));
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
				sp.texture = cloudTex[band][tier];
			}
		}
	}

	// Isolation: the focused band stays at full alpha, the others become ghosts.
	function retargetAlphas() {
		for (const band of BAND_KEYS)
			alphaTarget[band] = sky.focusBand === null || sky.focusBand === band ? 1 : GHOST_ALPHA;
	}

	function drawHover() {
		if (!hoverGfx || !geo) return;
		hoverGfx.clear();
		const code = sky.hoverCode;
		if (!code) return;
		const b = bins.find((x) => x.code === code);
		if (!b) return;
		const night = skyMode(sky.timeIndex) === 'night';
		hoverGfx
			.rect(b.px - 24, b.py - 28, 48, 52)
			.stroke({ width: 2, color: night ? UI.focus : 0xffffff, alignment: 0.5 });
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
			if (layers) layers.high.x = driftTick * CELL;
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
				sky.hoverCode = null;
				onhover?.(null);
				return;
			}
			const { ox, oy } = clientToWorld(e.clientX, e.clientY);
			const p = quad ? nearest(quad, ox, oy, HIT_R) : null;
			sky.hoverCode = p ? p.code : null;
			drawHover();
			if (enableTooltip)
				onhover?.(p ? { code: p.code, clientX: e.clientX, clientY: e.clientY } : null);
		});
		c.addEventListener('pointerup', (e) => {
			if (dragging && !moved) {
				const { ox, oy } = clientToWorld(e.clientX, e.clientY);
				const p = quad ? nearest(quad, ox, oy, HIT_R) : null;
				if (p) {
					sky.selectedCode = p.code;
					onselect?.(p.code);
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
			drawHover();
		}
	});
	$effect(() => {
		void sky.hoverCode;
		if (app) drawHover();
	});
</script>

<div class="pixel-map" bind:this={host}>
	<div class="zoom-ctl">
		<button aria-label="Zoom in" onclick={() => zoomButton(1)}>＋</button>
		<button aria-label="Zoom out" onclick={() => zoomButton(-1)}>－</button>
		<button aria-label="Reset view" onclick={resetView}>⤢</button>
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
	.zoom-ctl button {
		width: 32px;
		height: 32px;
		background: var(--paper);
		color: var(--ink);
		box-shadow: 0 0 0 2px var(--ink);
		font-family: var(--font-display);
		font-size: 14px;
		cursor: pointer;
	}
	.zoom-ctl button:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
</style>
