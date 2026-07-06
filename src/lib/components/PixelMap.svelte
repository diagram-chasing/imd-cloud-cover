<script lang="ts">
	import type { FeatureCollection } from 'geojson';
	import type { StationsManifest } from '$lib/types';
	import { cellForWidth } from '$lib/theme';
	import { SKY_RAMP } from '$lib/theme';
	import { buildProjection } from '$lib/map/projection';
	import { rasterizeLand } from '$lib/map/raster';
	import { buildStationPoints } from '$lib/map/stations';
	import { buildQuadtree, nearest, type StationPoint } from '$lib/map/hit';
	import { buildAtlas } from '$lib/map/sprites';
	import { generateStars } from '$lib/map/stars';
	import { drawBase, drawClouds, drawHover, type BandValues } from '$lib/map/render';
	import { sky } from '$lib/state/sky.svelte';

	interface Props {
		india: FeatureCollection;
		manifest: StationsManifest;
		values: BandValues;
		driftTick?: number;
		enableTooltip?: boolean;
		onhover?: (info: { code: string; clientX: number; clientY: number } | null) => void;
		onselect?: (code: string) => void;
	}

	let {
		india,
		manifest,
		values,
		driftTick = 0,
		enableTooltip = true,
		onhover,
		onselect
	}: Props = $props();

	let container = $state<HTMLDivElement>();
	let baseCanvas = $state<HTMLCanvasElement>();
	let cloudCanvas = $state<HTMLCanvasElement>();
	let uiCanvas = $state<HTMLCanvasElement>();

	let frameW = $state(900);

	// Layout derived from frame width.
	let cell = $derived(cellForWidth(frameW));
	let frameH = $derived(Math.round((frameW * 1.06) / cell) * cell);
	let cols = $derived(Math.floor(frameW / cell));
	let rows = $derived(Math.floor(frameH / cell));

	// Heavy geometry, rebuilt only when layout changes.
	let projection = $derived(buildProjection(india, cols * cell, rows * cell, cell));
	let raster = $derived(rasterizeLand(india, projection, cols, rows, cell));
	let points = $derived(buildStationPoints(manifest, projection, cell, cols, rows));
	let quadtree = $derived(buildQuadtree(points));
	let atlas = $derived(buildAtlas(cell));
	let stars = $derived(generateStars(cols, rows, cell));

	function setupCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
		const dpr = window.devicePixelRatio || 1;
		canvas.width = frameW * dpr;
		canvas.height = frameH * dpr;
		canvas.style.width = `${frameW}px`;
		canvas.style.height = `${frameH}px`;
		const ctx = canvas.getContext('2d')!;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.imageSmoothingEnabled = false;
		return ctx;
	}

	// Track container width.
	$effect(() => {
		if (!container) return;
		const ro = new ResizeObserver((entries) => {
			const w = entries[0].contentRect.width;
			if (w > 0) frameW = Math.round(w);
		});
		ro.observe(container);
		return () => ro.disconnect();
	});

	// Base layer: sky + land (+ stars at night). Redraw on layout/time/data change.
	$effect(() => {
		if (!baseCanvas) return;
		const ctx = setupCanvas(baseCanvas);
		drawBase(ctx, {
			cols,
			rows,
			cell,
			frameW,
			frameH,
			timeIndex: sky.timeIndex,
			raster,
			stars,
			values,
			points
		});
	});

	// Cloud layer.
	$effect(() => {
		if (!cloudCanvas) return;
		const ctx = setupCanvas(cloudCanvas);
		drawClouds(ctx, { points, values, bands: sky.bands, atlas, cell, frameW, frameH, driftTick });
	});

	// UI layer: hover highlight only.
	$effect(() => {
		if (!uiCanvas) return;
		const ctx = setupCanvas(uiCanvas);
		const code = sky.hoverCode;
		if (!code) {
			ctx.clearRect(0, 0, frameW, frameH);
			return;
		}
		const point = points.find((p) => p.code === code);
		if (!point) return;
		drawHover(ctx, {
			point,
			values,
			bands: sky.bands,
			atlas,
			cell,
			frameW,
			frameH,
			night: SKY_RAMP[sky.timeIndex].mode === 'night'
		});
	});

	function pointFromEvent(e: MouseEvent): { p: StationPoint | null; x: number; y: number } {
		const rect = uiCanvas!.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;
		return { p: nearest(quadtree, x, y, 24), x, y };
	}

	function handleMove(e: PointerEvent) {
		const { p } = pointFromEvent(e);
		sky.hoverCode = p ? p.code : null;
		if (enableTooltip) {
			onhover?.(p ? { code: p.code, clientX: e.clientX, clientY: e.clientY } : null);
		}
	}

	function handleLeave() {
		sky.hoverCode = null;
		onhover?.(null);
	}

	function handleClick(e: MouseEvent) {
		const { p } = pointFromEvent(e);
		if (p) {
			sky.selectedCode = p.code;
			onselect?.(p.code);
		}
	}
</script>

<div class="pixel-map" bind:this={container}>
	<div class="frame" style="aspect-ratio: {frameW} / {frameH};">
		<canvas bind:this={baseCanvas} class="layer" aria-hidden="true"></canvas>
		<canvas bind:this={cloudCanvas} class="layer" aria-hidden="true"></canvas>
		<canvas
			bind:this={uiCanvas}
			class="layer ui"
			aria-hidden="true"
			onpointermove={handleMove}
			onpointerleave={handleLeave}
			onclick={handleClick}
		></canvas>
	</div>
</div>

<style>
	.pixel-map {
		width: 100%;
	}
	.frame {
		position: relative;
		width: 100%;
		box-shadow: 0 0 0 2px var(--ink, #0b1d3a);
		overflow: hidden;
	}
	.layer {
		position: absolute;
		inset: 0;
		display: block;
		image-rendering: pixelated;
	}
	.ui {
		cursor: crosshair;
	}
</style>
