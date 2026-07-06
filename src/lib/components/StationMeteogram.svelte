<script lang="ts">
	import type { Forecast } from '$lib/types';
	import { UI } from '$lib/theme';

	interface Props {
		forecast: Forecast | null;
	}
	let { forecast }: Props = $props();

	let W = $state(320);
	const H = 100;

	function draw(canvas: HTMLCanvasElement, fc: Forecast | null) {
		const dpr = window.devicePixelRatio || 1;
		canvas.width = W * dpr;
		canvas.height = H * dpr;
		canvas.style.width = `${W}px`;
		canvas.style.height = `${H}px`;
		const ctx = canvas.getContext('2d')!;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.imageSmoothingEnabled = false;

		ctx.fillStyle = UI.accent;
		ctx.fillRect(0, 0, W, H);
		if (!fc || !fc.data.length) return;

		const n = fc.data.length;
		const bandH = H / 3;
		const stepW = W / n;
		const keys: ('high' | 'middle' | 'low')[] = ['high', 'middle', 'low'];

		ctx.fillStyle = '#ffffff';
		keys.forEach((key, band) => {
			const baseY = (band + 1) * bandH; // bottom of this band
			for (let i = 0; i < n; i++) {
				const v = Math.max(0, Math.min(100, fc.data[i][key])) / 100;
				const h = v * bandH;
				ctx.fillRect(Math.floor(i * stepW), baseY - h, Math.ceil(stepW), h);
			}
		});

		// Divider lines at 1/3 and 2/3.
		ctx.fillStyle = 'rgba(255,255,255,0.5)';
		ctx.fillRect(0, bandH, W, 1);
		ctx.fillRect(0, bandH * 2, W, 1);

		return;
	}

	function meteogram(node: HTMLCanvasElement) {
		$effect(() => {
			draw(node, forecast);
		});
	}
</script>

<canvas use:meteogram bind:clientWidth={W} aria-label="10-day cloud-cover forecast for this station"
></canvas>

<style>
	canvas {
		display: block;
		width: 100%;

		box-shadow: 0 0 0 2px var(--ink);
		image-rendering: pixelated;
	}
</style>
