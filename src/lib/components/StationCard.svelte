<script lang="ts">
	import type { Station, Rollup, Forecast } from '$lib/types';
	import { fetchForecast } from '$lib/api/r2';
	import { prettyDate } from '$lib/format';
	import { skyCondition } from '$lib/summary';
	import { CLEAR_STARS } from '$lib/theme';
	import StationMeteogram from './StationMeteogram.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';

	interface Props {
		code: string;
		station: Station;
		current: { h: number; m: number; l: number } | null;
		rollup: Rollup | null;
		date: string;
		/** Scrub-aware time descriptor, e.g. "15:00 IST" or "DAILY MEAN". */
		when: string;
		onclose?: () => void;
	}
	let { code, station, current, rollup, date, when, onclose }: Props = $props();

	let forecast = $state<Forecast | null>(null);
	let forecastError = $state(false);

	// One fetch per opened station (card mounts fresh each open).
	$effect(() => {
		forecast = null;
		forecastError = false;
		const c = code;
		fetchForecast(date, c)
			.then((f) => {
				if (c === code) forecast = f;
			})
			.catch(() => {
				if (c === code) forecastError = true;
			});
	});

	// Row labels mirror the tooltip + band legend so every surface speaks the
	// same language: altitude band · cloud species.
	const ROWS: { key: 'h' | 'm' | 'l'; label: string }[] = [
		{ key: 'h', label: 'HIGH · CIRRUS' },
		{ key: 'm', label: 'MID · ALTO' },
		{ key: 'l', label: 'LOW · CUMULUS' }
	];
	function filled(v: number): number {
		return Math.round(v / 10);
	}

	// Plain-language read of the sky, in NWS public sky-condition wording. Mirrors
	// StationTooltip so the card reads like a continuation of the hover.
	let summary = $derived(current ? skyCondition(current) : 'NO READING TODAY');

	let series = $derived(rollup?.stations[code] ?? null);

	// Current clear streak (effective < CLEAR_STARS) walking back from the latest day.
	let clearStreak = $derived.by(() => {
		if (!series) return 0;
		const e = series.e;
		let n = 0;
		for (let i = e.length - 1; i >= 0; i--) {
			const v = e[i];
			if (v === null || v >= CLEAR_STARS) break;
			n++;
		}
		return n;
	});
</script>

<div class="card flex w-full flex-col gap-3 text-ink">
	<header class="flex items-start justify-between gap-2.5">
		<div class="title">
			<h2 class="m-0 text-base leading-tight tracking-[0.03em] uppercase">{station.name}</h2>
			{#if station.state}<p class="state m-0 mt-0.5 text-xs opacity-70">{station.state}</p>{/if}
			<p class="when m-0 mt-[3px] text-xs tracking-wider opacity-60">
				{prettyDate(date)} · {when}
			</p>
		</div>
		<div class="head-right flex shrink-0 items-center gap-2">
			{#if clearStreak > 0}
				<Badge variant="outline" class="streak text-xs text-record-gold border-record-gold"
					>☀ {clearStreak}d clear</Badge
				>
			{/if}
			{#if onclose}
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Close"
					class="close"
					onclick={() => onclose?.()}>✕</Button
				>
			{/if}
		</div>
	</header>

	<!-- The read: plain-language summary + the H/M/L breakdown behind it -->
	<section class="readout flex flex-col gap-2">
		<p class="summary m-0 text-xs tracking-wider">{summary}</p>
		{#if current}
			<div class="bands flex flex-col gap-[3px]" aria-label="Percent of sky covered, by altitude">
				<!-- Caption muted via colour alpha (text-ink/55), not opacity, so the .now
				     highlight below can stay full-strength (opacity would compound onto the child).
				     The yellow "now" cue matches the current-day highlight on the chart. -->
				<p class="caption m-0 mb-[3px] text-xs tracking-wider text-ink/55">
					% OF SKY COVERED <span class="now bg-sun-gold px-[3px] py-px font-bold text-ink"
						>{when}</span
					>, BY ALTITUDE
				</p>
				{#each ROWS as row (row.key)}
					<div class="band-row flex items-center gap-2">
						<span class="blabel w-[104px] text-xs tracking-[0.03em] opacity-80">{row.label}</span>
						<span class="bar flex flex-1 gap-px" aria-hidden="true">
							{#each Array(10) as _, i (i)}
								<!-- Empty-track mist stays visible on cream paper (the shadcn --accent
								     token is near-white here, so it's set explicitly, not from --accent). -->
								<span
									class={[
										'seg h-2 flex-1',
										i < filled(current[row.key]) ? 'bg-day-sea' : 'bg-mist-300'
									]}
								></span>
							{/each}
						</span>
						<span class="num w-[38px] text-right text-xs">{current[row.key]}%</span>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<!-- The 10-day forecast: date axis + band tags live inside the chart -->
	<figure class="meteogram m-0">
		{#if forecastError}
			<p class="note py-6 text-center text-sm opacity-70">Forecast chart unavailable.</p>
		{:else}
			<StationMeteogram {forecast} today={date} />
		{/if}
	</figure>

	<!-- Primary CTA to the full station page -->
	<footer class="cta mt-0.5">
		<Button
			variant="default"
			size="sm"
			href="/station/{code}"
			class="more w-full bg-ink tracking-[0.06em] text-paper uppercase hover:bg-focus hover:text-ink"
			>More details →</Button
		>
	</footer>
</div>

<style>
	/* Bridge rule: the canvas lives inside StationMeteogram, so it can't be
	   classed from here. */
	.meteogram :global(canvas) {
		width: 100%;
		max-width: none;
	}
</style>
