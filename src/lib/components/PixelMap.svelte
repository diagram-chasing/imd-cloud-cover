<script lang="ts">
	import { Application, Container, Sprite, Texture, Graphics, Text, type Ticker } from 'pixi.js';
	import type { FeatureCollection } from 'geojson';
	import type { StationsManifest } from '$lib/types';
	import { CELL, SKY, skyMode, coverTier, UI, type BandKey } from '$lib/theme';
	import { buildGeo, type Geo } from '$lib/map/geo';
	import { buildMarkAtlas, MARK_VARIANTS } from '$lib/map/sprites';
	import { buildQuadtree, nearest, type StationPoint } from '$lib/map/hit';
	import { fnv1a, jitter } from '$lib/map/hash';
	import { sky } from '$lib/state/sky.svelte';
	import { Button } from '$lib/components/ui/button';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { PlusSignIcon, MinusSignIcon, Maximize01Icon } from '@hugeicons/core-free-icons';

	interface Props {
		india: FeatureCollection;
		manifest: StationsManifest;
		values: Record<string, { h: number; m: number; l: number }>;
		persistence?: Record<string, number>;
		enableTooltip?: boolean;
		onhover?: (info: { code: string; clientX: number; clientY: number } | null) => void;
		onselect?: (code: string, at?: { x: number; y: number }) => void;
	}
	let { india, manifest, values, enableTooltip = true, onhover, onselect }: Props = $props();

	const WORLD_W = 1024;
	const PAD = 4;
	const MARK_CELL = 4; // px per logical cell of a tower mark
	// Two constraints keep towers readable (glyphs cap at 3 rows tall):
	//   1. bands separate WITHIN a tower  → TOWER_GAP must clear a mark's height
	//   2. towers separate FROM EACH OTHER → BIN must clear a whole tower's height
	// Break either (e.g. TOWER_GAP > BIN) and the three bands overlap into blocks.
	const TOWER_GAP = MARK_CELL * 3.5; // centre-to-centre px between adjacent bands
	const BIN = TOWER_GAP * 2 + MARK_CELL * 3; // aggregation grid spacing (px)
	const HIT_R = BIN * 0.7; // hover/select radius; >= BIN/sqrt(2) so bins have no dead zones
	const GHOST_ALPHA = 0.1; // non-focused bands while one band is isolated
	// Vertical offset of each band's mark from the bin centre, in px.
	const BAND_OFFSET: Record<BandKey, number> = {
		high: -TOWER_GAP,
		middle: 0,
		low: TOWER_GAP
	};
	const BAND_KEYS: BandKey[] = ['low', 'middle', 'high'];
	const VAL_KEY: Record<BandKey, 'h' | 'm' | 'l'> = { high: 'h', middle: 'm', low: 'l' };

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
	let bins: Bin[] = [];
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
				b = { px: (bx + 0.5) * BIN, py: (by + 0.5) * BIN, members: [], code: st.code, variant: 0 };
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
			// Break the grid: nudge each tower a few px and pick a stable shape
			// variant, both keyed off the station so the render stays deterministic.
			b.px += jitter(b.code, 'jx', 3);
			b.py += jitter(b.code, 'jy', 2);
			b.variant = fnv1a(b.code) % MARK_VARIANTS;
		}
		// north-first so nearer (south) marks overdraw
		return [...map.values()].sort((a, b) => a.py - b.py);
	}

	async function init() {
		if (!host) return;
		const atlas = buildMarkAtlas(MARK_CELL);
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

		// Faint story title, anchored to the left of the world so it pans and
		// zooms with the map. Sits above the ground but under the cloud marks.
		titleText = new Text({
			text: STORY_TITLE,
			style: {
				fontFamily: "'Silkscreen', monospace",
				fontWeight: '700',
				align: 'left',
				fill: 0xffffff,
				wordWrap: true,
				wordWrapWidth: 2
			}
		});
		titleText.anchor.set(1.2, 0.5);
		titleText.eventMode = 'none';
		camera.addChild(titleText);

		cloudTex = { low: [], middle: [], high: [] };
		for (const band of BAND_KEYS) {
			for (let tier = 1; tier <= 4; tier++) {
				cloudTex[band][tier] = [];
				for (let v = 0; v < MARK_VARIANTS; v++) {
					cloudTex[band][tier][v] = mkTex(atlas.get(band, tier as 1 | 2 | 3 | 4, v).canvas);
				}
			}
		}

		const layerMap = {} as Record<BandKey, Container>;
		for (const band of BAND_KEYS) {
			const layer = new Container();
			camera.addChild(layer);
			layerMap[band] = layer;
			pool[band] = bins.map((b) => {
				const s = new Sprite(cloudTex[band][1][b.variant]);
				s.anchor.set(0.5, 0.5);
				s.x = b.px;
				s.y = b.py + BAND_OFFSET[band];
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

	function drawSky() {
		if (!skyGfx) return;
		const pal = SKY[skyMode(sky.timeIndex)];
		skyGfx.clear();
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

	function drawHover() {
		if (!hoverGfx || !geo) return;
		hoverGfx.clear();
		const code = sky.hoverCode;
		if (!code) return;
		const b = bins.find((x) => x.code === code);
		if (!b) return;
		const night = skyMode(sky.timeIndex) === 'night';
		// Frame the whole tower: from above the high mark to below the low mark.
		const halfW = 18;
		const top = b.py - TOWER_GAP - 12;
		const height = TOWER_GAP * 2 + 24;
		hoverGfx
			.rect(b.px - halfW, top, halfW * 2, height)
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
		const halfW = 18;
		const top = b.py - TOWER_GAP - 12;
		const height = TOWER_GAP * 2 + 24;
		selGfx
			.rect(b.px - halfW, top, halfW * 2, height)
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
			// alive without detaching the small marks from their towers.
			if (layers) layers.high.x = driftTick * 2;
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
				// Panning detaches the card from its cell — dismiss it.
				if (moved && sky.selectedCode) sky.selectedCode = null;
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
