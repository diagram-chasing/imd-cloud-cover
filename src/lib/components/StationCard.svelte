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

<div class="card">
	<header>
		<div class="title">
			<h2>{station.name}</h2>
			{#if station.state}<p class="state">{station.state}</p>{/if}
			<p class="when">{prettyDate(date)} · {when}</p>
		</div>
		<div class="head-right">
			{#if clearStreak > 0}
				<Badge variant="outline" class="streak">☀ {clearStreak}d clear</Badge>
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
	<section class="readout">
		<p class="summary">{summary}</p>
		{#if current}
			<div class="bands" aria-label="Percent of sky covered, by altitude">
				<p class="caption">% OF SKY COVERED <span class="now">{when}</span>, BY ALTITUDE</p>
				{#each ROWS as row (row.key)}
					<div class="band-row">
						<span class="blabel">{row.label}</span>
						<span class="bar" aria-hidden="true">
							{#each Array(10) as _, i (i)}
								<span class="seg" class:on={i < filled(current[row.key])}></span>
							{/each}
						</span>
						<span class="num">{current[row.key]}%</span>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<!-- The 10-day forecast: date axis + band tags live inside the chart -->
	<figure class="meteogram">
		{#if forecastError}
			<p class="note">Forecast chart unavailable.</p>
		{:else}
			<StationMeteogram {forecast} today={date} />
		{/if}
	</figure>

	<footer class="cta">
		<Button variant="default" size="sm" href="/station/{code}" class="more">More details →</Button>
	</footer>
</div>

<style>
	.card {
		display: flex;
		flex-direction: column;
		gap: 12px;
		width: 100%;
		color: var(--ink);
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 10px;
	}
	.title h2 {
		font-family: var(--font-display);
		font-size: 15px;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		margin: 0;
		line-height: 1.2;
	}
	.state {
		font-size: 12px;
		opacity: 0.7;
		margin: 2px 0 0;
	}
	.when {
		font-family: var(--font-display);
		font-size: 11px;
		letter-spacing: 0.05em;
		opacity: 0.6;
		margin: 3px 0 0;
	}
	.head-right {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}
	.head-right :global(.streak) {
		font-family: var(--font-display);
		font-size: 12px;
		color: #b8860b;
		border-color: #b8860b;
		white-space: nowrap;
	}

	/* The read */
	.readout {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.summary {
		font-family: var(--font-display);
		font-size: 12px;
		letter-spacing: 0.05em;
		margin: 0;
	}
	.bands {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.caption {
		font-family: var(--font-display);
		font-size: 12px;
		letter-spacing: 0.05em;
		/* Muted via colour alpha, not opacity, so the .now highlight below can
		   stay full-strength (opacity would compound onto the child). */
		color: rgba(11, 29, 58, 0.55);
		margin: 0 0 3px;
	}
	/* Yellow "now" cue, matching the current-day highlight on the chart. */
	.caption .now {
		background: var(--sun-gold);
		color: var(--ink);
		font-weight: 700;
		padding: 1px 3px;
	}
	.band-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.blabel {
		font-family: var(--font-display);
		font-size: 12px;
		letter-spacing: 0.03em;
		width: 104px;
		opacity: 0.8;
	}
	.bar {
		display: flex;
		gap: 1px;
		flex: 1;
	}
	.seg {
		flex: 1;
		height: 8px;
		/* An empty-track that stays visible on cream paper (the shadcn --accent
		   token is near-white here, so it's set explicitly, not from a var). */
		background: #cddcec;
	}
	.seg.on {
		background: #2e7cc4;
	}
	.num {
		font-family: var(--font-display);
		font-size: 12px;
		width: 38px;
		text-align: right;
	}

	.meteogram {
		margin: 0;
	}
	.meteogram :global(canvas) {
		width: 100%;
		max-width: none;
	}
	.note {
		font-size: 13px;
		opacity: 0.7;
		padding: 24px 0;
		text-align: center;
	}

	/* Primary CTA to the full station page */
	.cta {
		margin-top: 2px;
	}
	.cta :global(.more) {
		width: 100%;
		font-family: var(--font-display);
		font-size: 12px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		background: var(--ink);
		color: var(--paper);
	}
	.cta :global(.more:hover) {
		background: var(--focus);
		color: var(--ink);
	}
</style>
