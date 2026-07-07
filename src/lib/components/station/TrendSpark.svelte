<script lang="ts">
	import type { Rollup } from '$lib/types';

	interface Props {
		rollup: Rollup;
		code: string;
	}
	let { rollup, code }: Props = $props();

	let W = $state(320);
	const H = 72;
	const PAD = 6; // breathing room so a 0 or 100 day doesn't touch the frame

	function y(v: number): number {
		return Math.round(PAD + (1 - v / 100) * (H - PAD * 2));
	}

	function draw(canvas: HTMLCanvasElement, r: Rollup, c: string) {
		const dpr = window.devicePixelRatio || 1;
		// CSS owns the layout size; only the backing store scales with dpr.
		canvas.width = Math.max(1, Math.round(W * dpr));
		canvas.height = H * dpr;
		const ctx = canvas.getContext('2d')!;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.imageSmoothingEnabled = false;

		ctx.fillStyle = '#fdfbf4';
		ctx.fillRect(0, 0, W, H);

		const mine = r.stations[c]?.e;
		const nat = r.national.e;
		if (!mine) return;
		const n = mine.length;
		const colW = W / n;

		// Stepped series, one flat tread per day — pixel steps, not smooth lines.
		const step = (series: (number | null)[], color: string, thick: number, alpha: number) => {
			ctx.globalAlpha = alpha;
			ctx.fillStyle = color;
			for (let i = 0; i < n; i++) {
				const v = series[i];
				if (v === null || v === undefined) continue;
				ctx.fillRect(Math.floor(i * colW), y(v), Math.ceil(colW), thick);
			}
			ctx.globalAlpha = 1;
		};
		step(nat, '#43536e', 1, 0.45);
		step(mine, '#0b1d3a', 3, 1);
	}

	function spark(node: HTMLCanvasElement) {
		$effect(() => {
			draw(node, rollup, code);
		});
	}
</script>

<canvas
	use:spark
	bind:clientWidth={W}
	aria-label="Daily effective cloud cover for this station against the national mean over the last {rollup.window} days"
></canvas>

<style>
	canvas {
		display: block;
		width: 100%;
		height: 72px;
		box-shadow: 0 0 0 2px var(--ink);
		image-rendering: pixelated;
	}
</style>
