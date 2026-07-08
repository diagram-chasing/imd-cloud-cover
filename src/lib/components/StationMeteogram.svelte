<script lang="ts">
	import type { Forecast } from '$lib/types';
	import { UI, CLOUD, type BandKey } from '$lib/theme';

	interface Props {
		forecast: Forecast | null;
		/** ISO date (YYYY-MM-DD) whose axis label is highlighted as "current". */
		today?: string;
	}
	let { forecast, today }: Props = $props();

	let W = $state(320);
	const H = 102;
	const CELL = 5; // px per pixel-cell — chunky, matches the map's tower marks
	const KEYS: BandKey[] = ['high', 'middle', 'low'];
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

	// A tick at the first sample of each calendar day. Position is a % of the
	// canvas width so the axis stays aligned under the chart at any size.
	interface Tick {
		pct: number;
		day: number;
		month: string;
		showMonth: boolean;
		iso: string;
	}
	let ticks = $derived.by<Tick[]>(() => {
		const fc = forecast;
		if (!fc || !fc.data.length) return [];
		const n = fc.data.length;
		const out: Tick[] = [];
		let prevDate = '';
		let prevMonth = -1;
		for (let i = 0; i < n; i++) {
			const iso = fc.data[i].datetime.slice(0, 10); // YYYY-MM-DD
			if (iso === prevDate) continue;
			prevDate = iso;
			const [, m, d] = iso.split('-').map(Number);
			out.push({
				pct: (i / n) * 100,
				day: d,
				month: MONTHS[m - 1],
				// Month only at a rollover (day resets to 1), never on the first tick —
				// avoids the month word colliding with the next day's label.
				showMonth: prevMonth !== -1 && m - 1 !== prevMonth,
				iso
			});
			prevMonth = m - 1;
		}
		return out;
	});

	// The "current" day: the first ticked day on/after `today`. When the outlook
	// opens the day after the scrape date, that's simply the first tick.
	let currentIso = $derived.by<string | null>(() => {
		if (!today || !ticks.length) return null;
		const hit = ticks.find((t) => t.iso >= today);
		return hit ? hit.iso : null;
	});

	// Flatten a translucent cloud colour onto the sky into one opaque shade. The
	// bands are drawn per-column and neighbouring columns overlap by a pixel; with
	// a translucent fill that seam double-applies the alpha and reads as darker
	// vertical banding (worst on low-alpha cirrus). Painting a solid pre-blended
	// shade at full opacity removes the seam while keeping the same colour.
	function hexRgb(hex: string): [number, number, number] {
		const h = hex.replace('#', '');
		return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
	}
	function flatten(fg: string, bg: string, a: number): string {
		const f = hexRgb(fg);
		const b = hexRgb(bg);
		const mix = (i: number) => Math.round(f[i] * a + b[i] * (1 - a));
		return `rgb(${mix(0)},${mix(1)},${mix(2)})`;
	}

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
			// Pre-blend the band colour onto the sky so it can paint opaque — no
			// alpha, so overlapping column seams don't darken.
			const solid = flatten(conf.fill, UI.accent, conf.alpha);
			const baseY = (band + 1) * bandH; // bottom of this band's strip
			for (let c = 0; c < cols; c++) {
				const filled = Math.round(colValue(fc, key, c, cols) * levels);
				if (!filled) continue;
				const x = Math.floor(c * cw);
				const w = Math.ceil(cw);
				const topY = baseY - filled * ch;

				ctx.fillStyle = solid;
				ctx.fillRect(x, topY, w, filled * ch);

				// Cumulus sits on a shaded base — same cue the map's low marks use.
				// Keep it a thin sliver so it grounds the puff without weighing it down.
				if (shadow && filled >= 2) {
					const sh = Math.max(1, Math.round(ch / 2));
					ctx.fillStyle = shadow;
					ctx.fillRect(x, baseY - sh, w, sh);
				}
			}
		});

		// Day gridlines, snapped to the cell grid, so each column reads as a day.
		ctx.fillStyle = 'rgba(255,255,255,0.18)';
		for (const t of ticks) {
			if (t.pct <= 0) continue;
			ctx.fillRect(Math.round((t.pct / 100) * W), 0, 1, H);
		}

		// Divider lines at 1/3 and 2/3, snapped to the cell grid.
		ctx.fillStyle = 'rgba(255,255,255,0.5)';
		ctx.fillRect(0, Math.round(bandH), W, 1);
		ctx.fillRect(0, Math.round(bandH * 2), W, 1);
	}

	function meteogram(node: HTMLCanvasElement) {
		$effect(() => {
			void ticks; // redraw gridlines when the day boundaries change
			draw(node, forecast);
		});
	}
</script>

<div class="chart">
	<div class="canvas-wrap">
		<canvas
			use:meteogram
			bind:clientWidth={W}
			aria-label="10-day cloud-cover forecast for this station"
		></canvas>
		<div class="band-tags" aria-hidden="true">
			<div class="band-tag"><span>HIGH</span></div>
			<div class="band-tag"><span>MID</span></div>
			<div class="band-tag"><span>LOW</span></div>
		</div>
	</div>
	{#if ticks.length}
		<div class="axis" aria-hidden="true">
			{#each ticks as t (t.pct)}
				<div class="tick" class:current={t.iso === currentIso} style="left:{t.pct}%">
					<span class="mark"></span>
					<span class="label">{t.day}{t.showMonth ? ' ' + t.month : ''}</span>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.chart {
		display: flex;
		flex-direction: column;
		gap: 0;
	}
	.canvas-wrap {
		position: relative;
	}
	canvas {
		display: block;
		width: 100%;
		height: 70px;
		box-shadow: 0 0 0 2px var(--ink);
		image-rendering: pixelated;
	}

	/* HIGH / MID / LOW tags pinned to the top-right of each 1/3 strip. */
	.band-tags {
		position: absolute;
		inset: 0;
		pointer-events: none;
		display: flex;
		flex-direction: column;
	}
	.band-tag {
		flex: 1;
		display: flex;
		align-items: flex-start;
		justify-content: flex-end;
		padding: 3px 5px 0 0;
	}
	.band-tag span {
		font-family: var(--font-display);
		font-size: 12px;
		line-height: 1;
		letter-spacing: 0.06em;
		color: var(--ink);
		background: rgba(253, 251, 244, 0.78);
		padding: 1px 4px;
	}

	/* Date axis: a tick per day boundary, day-of-month labels. */
	.axis {
		position: relative;
		height: 20px;
		margin-top: 5px;
	}
	.tick {
		position: absolute;
		top: 0;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
	}
	.tick:first-child {
		transform: none;
		align-items: flex-start;
	}
	.mark {
		width: 1px;
		height: 3px;
		background: var(--ink);
		opacity: 0.4;
	}
	.label {
		font-family: var(--font-display);
		font-size: 12px;
		letter-spacing: 0.02em;
		color: var(--ink);
		opacity: 0.6;
		white-space: nowrap;
		/* Every label carries the same padding box so the highlighted one keeps
		   the same height/baseline as its neighbours. */
		padding: 1px 3px;
	}
	/* The current day: yellow, so the eye lands on "where we are" first. */
	.tick.current .mark {
		background: var(--sun-gold);
		opacity: 1;
		height: 4px;
	}
	.tick.current .label {
		color: var(--ink);
		opacity: 1;
		font-weight: 700;
		background: var(--sun-gold);
	}
</style>
