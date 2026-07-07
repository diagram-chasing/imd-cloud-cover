<script lang="ts">
	import type { StationBands } from '$lib/types';
	import { CLOUD, SKY, UI, skyMode, RAIN, RAIN_FLOOR, type BandKey } from '$lib/theme';
	import { STEP_TICKS } from '$lib/station-facts';

	interface Props {
		bands: StationBands;
		clearestIdx?: number;
		cloudiestIdx?: number;
	}
	let { bands, clearestIdx = -1, cloudiestIdx = -1 }: Props = $props();

	let W = $state(320);
	const H = 138;
	const CELL = 5; // chunky pixel quantum, matches the map's marks
	const STEPS = 8;
	const KEYS: BandKey[] = ['high', 'middle', 'low'];
	const BKEY: Record<BandKey, 'h' | 'm' | 'l'> = { high: 'h', middle: 'm', low: 'l' };

	function draw(canvas: HTMLCanvasElement, b: StationBands) {
		const dpr = window.devicePixelRatio || 1;
		// CSS owns the layout size (width 100%); only the backing store scales,
		// so bind:clientWidth keeps tracking the real laid-out width.
		canvas.width = Math.max(1, Math.round(W * dpr));
		canvas.height = H * dpr;
		const ctx = canvas.getContext('2d')!;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.imageSmoothingEnabled = false;

		const colW = W / STEPS;
		// Column skies first: day blue / night navy, same palette as the map.
		for (let c = 0; c < STEPS; c++) {
			ctx.fillStyle = skyMode(c) === 'night' ? SKY.night.bottom : UI.accent;
			ctx.fillRect(Math.floor(c * colW), 0, Math.ceil(colW), H);
		}

		const bandH = H / 3;
		const GUTTER = CELL;
		const effH = bandH - GUTTER;
		const levels = Math.max(3, Math.round(effH / CELL));
		const ch = effH / levels;

		KEYS.forEach((key, band) => {
			const conf = CLOUD[key];
			const shadow = 'shadow' in conf ? conf.shadow : null;
			const baseY = (band + 1) * bandH;
			for (let c = 0; c < STEPS; c++) {
				const v = Math.max(0, Math.min(100, b[BKEY[key]][c] ?? 0));
				const filled = Math.round((v / 100) * levels);
				if (!filled) continue;
				// Inset each column a hair so steps read as discrete readings.
				const x = Math.floor(c * colW) + 1;
				const w = Math.ceil(colW) - 2;
				const topY = baseY - filled * ch;

				ctx.globalAlpha = conf.alpha;
				ctx.fillStyle = conf.fill;
				ctx.fillRect(x, topY, w, filled * ch);
				if (shadow && filled >= 2) {
					const sh = Math.max(1, Math.round(ch / 2));
					ctx.fillStyle = shadow;
					ctx.fillRect(x, baseY - sh, w, sh);
				}
				ctx.globalAlpha = 1;
			}
		});

		// Rain streaks under the cumulus for steps with a real precip signal.
		ctx.fillStyle = RAIN.fill;
		for (let c = 0; c < STEPS; c++) {
			if ((b.p[c] ?? 0) < RAIN_FLOOR) continue;
			const x0 = Math.floor(c * colW);
			for (let k = 0; k < 3; k++) {
				const sx = x0 + Math.round(((k + 1) * colW) / 4) - 1;
				ctx.fillRect(sx, H - 10, 2, 7);
			}
		}

		// Band dividers, snapped like the meteogram's.
		ctx.fillStyle = 'rgba(255,255,255,0.5)';
		ctx.fillRect(0, Math.round(bandH), W, 1);
		ctx.fillRect(0, Math.round(bandH * 2), W, 1);
	}

	function strip(node: HTMLCanvasElement) {
		$effect(() => {
			draw(node, bands);
		});
	}
</script>

<div class="wrap">
	<canvas
		use:strip
		bind:clientWidth={W}
		aria-label="Today's cloud cover by time of day: high, mid and low bands across eight 3-hourly steps"
	></canvas>
	<div class="ticks" aria-hidden="true">
		{#each STEP_TICKS as t, i (t)}
			<span class:sun={i === clearestIdx} class:heavy={i === cloudiestIdx}>{t}</span>
		{/each}
	</div>
</div>

<style>
	canvas {
		display: block;
		width: 100%;
		height: 138px;
		box-shadow: 0 0 0 2px var(--ink);
		image-rendering: pixelated;
	}
	.ticks {
		display: grid;
		grid-template-columns: repeat(8, 1fr);
		margin-top: 6px;
	}
	.ticks span {
		font-family: var(--font-display);
		font-size: 10px;
		letter-spacing: 0.05em;
		text-align: center;
		opacity: 0.55;
	}
	.ticks span.sun {
		opacity: 1;
		color: #b8860b;
	}
	.ticks span.heavy {
		opacity: 1;
		font-weight: 700;
	}
</style>
