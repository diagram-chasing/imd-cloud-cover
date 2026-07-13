<script lang="ts">
	import type { Forecast } from '$lib/types';
	import { UI, CLOUD, type BandKey } from '$lib/theme';
	import { fade } from 'svelte/transition';

	interface Props {
		forecast: Forecast | null;
		today?: string;
	}
	let { forecast, today }: Props = $props();

	let W = $state(320);
	const H = 102;
	const CELL = 5;
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
			const iso = fc.data[i].datetime.slice(0, 10);
			if (iso === prevDate) continue;
			prevDate = iso;
			const [, m, d] = iso.split('-').map(Number);
			out.push({
				pct: (i / n) * 100,
				day: d,
				month: MONTHS[m - 1],
				showMonth: prevMonth !== -1 && m - 1 !== prevMonth,
				iso
			});
			prevMonth = m - 1;
		}
		return out;
	});

	let loading = $derived(!forecast || !forecast.data.length);

	let currentIso = $derived.by<string | null>(() => {
		if (!today || !ticks.length) return null;
		const hit = ticks.find((t) => t.iso >= today);
		return hit ? hit.iso : null;
	});

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
		canvas.width = Math.max(1, Math.round(W * dpr));
		canvas.height = H * dpr;
		const ctx = canvas.getContext('2d')!;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.imageSmoothingEnabled = false;

		const bandH = H / 3;

		ctx.fillStyle = UI.accent;
		ctx.fillRect(0, 0, W, H);

		// Band separators — drawn in every state so the empty skeleton already reads as
		// the three-band chart and the fill just paints in when the forecast arrives.
		ctx.fillStyle = 'rgba(255,255,255,0.5)';
		ctx.fillRect(0, Math.round(bandH), W, 1);
		ctx.fillRect(0, Math.round(bandH * 2), W, 1);

		if (!fc || !fc.data.length) {
			// Faint dotted baseline in each band as a placeholder footprint.
			ctx.fillStyle = 'rgba(255,255,255,0.09)';
			for (let band = 0; band < 3; band++) {
				const y = Math.round((band + 1) * bandH - CELL);
				for (let x = 0; x < W; x += CELL * 2) ctx.fillRect(x, y, CELL, CELL);
			}
			return;
		}

		const cols = Math.max(1, Math.round(W / CELL));
		const cw = W / cols;

		const GUTTER = CELL;
		const effH = bandH - GUTTER;
		const levels = Math.max(3, Math.round(effH / CELL));
		const ch = effH / levels;

		KEYS.forEach((key, band) => {
			const conf = CLOUD[key];
			const shadow = 'shadow' in conf ? conf.shadow : null;

			const solid = flatten(conf.fill, UI.accent, conf.alpha);
			const baseY = (band + 1) * bandH;
			for (let c = 0; c < cols; c++) {
				const filled = Math.round(colValue(fc, key, c, cols) * levels);
				if (!filled) continue;
				const x = Math.floor(c * cw);
				const w = Math.ceil(cw);
				const topY = baseY - filled * ch;

				ctx.fillStyle = solid;
				ctx.fillRect(x, topY, w, filled * ch);

				if (shadow && filled >= 2) {
					const sh = Math.max(1, Math.round(ch / 2));
					ctx.fillStyle = shadow;
					ctx.fillRect(x, baseY - sh, w, sh);
				}
			}
		});

		ctx.fillStyle = 'rgba(255,255,255,0.18)';
		for (const t of ticks) {
			if (t.pct <= 0) continue;
			ctx.fillRect(Math.round((t.pct / 100) * W), 0, 1, H);
		}

		ctx.fillStyle = 'rgba(255,255,255,0.5)';
		ctx.fillRect(0, Math.round(bandH), W, 1);
		ctx.fillRect(0, Math.round(bandH * 2), W, 1);
	}

	function meteogram(node: HTMLCanvasElement) {
		$effect(() => {
			void ticks;
			draw(node, forecast);
		});
	}
</script>

<div class="chart flex flex-col">
	<div class="canvas-wrap relative">
		<canvas
			use:meteogram
			bind:clientWidth={W}
			aria-label="10-day cloud-cover forecast for this station"
			class="block h-[70px] w-full shadow-[0_0_0_2px] shadow-ink [image-rendering:pixelated]"
		></canvas>
		{#if loading}
			<div
				class="pointer-events-none absolute inset-0 flex flex-col motion-safe:animate-pulse"
				aria-hidden="true"
				out:fade={{ duration: 260 }}
			>
				{#each KEYS as k (k)}
					<div class="flex flex-1 items-end px-px pb-px">
						<span class="h-1/3 w-full bg-white/12"></span>
					</div>
				{/each}
			</div>
		{/if}
		<div class="band-tags pointer-events-none absolute inset-0 flex flex-col" aria-hidden="true">
			<div class="flex flex-1 items-start justify-end pt-[3px] pr-[5px]">
				<span class="bg-paper/78 px-1 py-px text-xs leading-none tracking-[0.06em] text-ink"
					>HIGH</span
				>
			</div>
			<div class="flex flex-1 items-start justify-end pt-[3px] pr-[5px]">
				<span class="bg-paper/78 px-1 py-px text-xs leading-none tracking-[0.06em] text-ink"
					>MID</span
				>
			</div>
			<div class="flex flex-1 items-start justify-end pt-[3px] pr-[5px]">
				<span class="bg-paper/78 px-1 py-px text-xs leading-none tracking-[0.06em] text-ink"
					>LOW</span
				>
			</div>
		</div>
	</div>
	<!-- Axis height is always reserved so the row never appears late and shifts the layout. -->
	<div class="axis relative mt-[5px] h-5" aria-hidden="true">
		{#if ticks.length}
			{#each ticks as t (t.pct)}
				<div
					class="tick absolute top-0 flex -translate-x-1/2 flex-col items-center gap-0.5 first:translate-x-0 first:items-start"
					style="left:{t.pct}%"
				>
					<span
						class={[
							'mark w-px',
							t.iso === currentIso ? 'h-1 bg-sun-gold' : 'h-[3px] bg-ink opacity-40'
						]}
					></span>
					<span
						class={[
							'label px-[3px] py-px text-xs tracking-[0.02em] whitespace-nowrap text-ink',
							t.iso === currentIso ? 'bg-sun-gold font-bold' : 'opacity-60'
						]}>{t.day}{t.showMonth ? ' ' + t.month : ''}</span
					>
				</div>
			{/each}
		{:else if loading}
			<div class="flex justify-between motion-safe:animate-pulse" out:fade={{ duration: 260 }}>
				{#each Array(11) as _, i (i)}
					<div class="flex flex-col items-center gap-0.5">
						<span class="h-[3px] w-px bg-ink opacity-25"></span>
						<span class="h-3 w-3.5 bg-ink/10"></span>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
