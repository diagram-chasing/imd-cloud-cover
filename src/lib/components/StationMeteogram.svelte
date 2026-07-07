<script lang="ts">
	import type { Forecast } from '$lib/types';
	import { UI, CLOUD, type BandKey } from '$lib/theme';

	interface Props {
		forecast: Forecast | null;
	}
	let { forecast }: Props = $props();

	let W = $state(320);
	const H = 102;
	const CELL = 5; // px per pixel-cell — chunky, matches the map's tower marks
	const KEYS: BandKey[] = ['high', 'middle', 'low'];

	// Average the band's cover across the samples that fall inside a column, so
	// downsampling to chunky cells reads the whole 3-hourly series rather than
	// whatever sample happens to land on a cell boundary.
	function colValue(fc: Forecast, key: BandKey, c: number, cols: number): number {
		const n = fc.data.length;
		const a = Math.floor((c / cols) * n);
		const b = Math.max(a + 1, Math.floor(((c + 1) / cols) * n));
		let s = 0;
		let k = 0;
		for (let i = a; i < b && i < n; i++) {
			s += Math.max(0, Math.min(100, fc.data[i][key]));
			k++;
		}
		return k ? s / k / 100 : 0;
	}

	function draw(canvas: HTMLCanvasElement, fc: Forecast | null) {
		const dpr = window.devicePixelRatio || 1;
		// CSS owns the layout size (width 100%); setting inline width here would
		// override it and freeze clientWidth at whatever it was on first draw.
		canvas.width = Math.max(1, Math.round(W * dpr));
		canvas.height = H * dpr;
		const ctx = canvas.getContext('2d')!;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.imageSmoothingEnabled = false;

		ctx.fillStyle = UI.accent; // flat sky behind the clouds
		ctx.fillRect(0, 0, W, H);
		if (!fc || !fc.data.length) return;

		const cols = Math.max(1, Math.round(W / CELL));
		const cw = W / cols;
		const bandH = H / 3;
		// Reserve a slim gutter at the top of each strip so a full band doesn't
		// butt right up against the one above it.
		const GUTTER = CELL;
		const effH = bandH - GUTTER;
		// Whole cells per band, so tops quantize to the grid (blocky, not smooth).
		const levels = Math.max(3, Math.round(effH / CELL));
		const ch = effH / levels;

		KEYS.forEach((key, band) => {
			const conf = CLOUD[key];
			const shadow = 'shadow' in conf ? conf.shadow : null;
			const baseY = (band + 1) * bandH; // bottom of this band's strip
			for (let c = 0; c < cols; c++) {
				const filled = Math.round(colValue(fc, key, c, cols) * levels);
				if (!filled) continue;
				const x = Math.floor(c * cw);
				const w = Math.ceil(cw);
				const topY = baseY - filled * ch;

				ctx.globalAlpha = conf.alpha;
				ctx.fillStyle = conf.fill;
				ctx.fillRect(x, topY, w, filled * ch);

				// Cumulus sits on a shaded base — same cue the map's low marks use.
				// Keep it a thin sliver so it grounds the puff without weighing it down.
				if (shadow && filled >= 2) {
					const sh = Math.max(1, Math.round(ch / 2));
					ctx.fillStyle = shadow;
					ctx.fillRect(x, baseY - sh, w, sh);
				}
				ctx.globalAlpha = 1;
			}
		});

		// Divider lines at 1/3 and 2/3, snapped to the cell grid.
		ctx.fillStyle = 'rgba(255,255,255,0.5)';
		ctx.fillRect(0, Math.round(bandH), W, 1);
		ctx.fillRect(0, Math.round(bandH * 2), W, 1);
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
		height: 102px;
		box-shadow: 0 0 0 2px var(--ink);
		image-rendering: pixelated;
	}
</style>
