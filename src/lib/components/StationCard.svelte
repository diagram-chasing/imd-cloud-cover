<script lang="ts">
	import type { Station, Rollup, Forecast } from '$lib/types';
	import { fetchForecast, meteogramImageUrl } from '$lib/api/r2';
	import { CLEAR_STARS } from '$lib/theme';
	import StationMeteogram from './StationMeteogram.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Separator } from '$lib/components/ui/separator';

	interface Props {
		code: string;
		station: Station;
		current: { h: number; m: number; l: number } | null;
		rollup: Rollup | null;
		date: string;
		onclose?: () => void;
	}
	let { code, station, current, rollup, date, onclose }: Props = $props();

	let forecast = $state<Forecast | null>(null);
	let forecastError = $state(false);
	let copied = $state(false);

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

	const ROWS: { key: 'h' | 'm' | 'l'; label: string }[] = [
		{ key: 'h', label: 'H' },
		{ key: 'm', label: 'M' },
		{ key: 'l', label: 'L' }
	];
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

	async function copyPermalink() {
		try {
			await navigator.clipboard.writeText(`${location.origin}/station/${code}`);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			copied = false;
		}
	}
</script>

<div class="card">
	<header>
		<div class="title">
			<h2>{station.name}</h2>
			{#if station.state}<p class="state">{station.state}</p>{/if}
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

	<!-- Priority 1: the meteogram -->
	<figure class="meteogram">
		{#if forecastError}
			<p class="note">Forecast chart unavailable.</p>
		{:else}
			<StationMeteogram {forecast} />
		{/if}
		<figcaption>10-day forecast · 3-hourly · high / mid / low</figcaption>
	</figure>

	<!-- Priority 2: the sky calendar -->
	{#if series}
		<section class="calendar">
			<h3>SKY CALENDAR · {rollup?.window ?? 30} DAYS</h3>
			{#each ROWS as r (r.key)}
				<div class="cal-row">
					<span class="cal-label">{r.label}</span>
					<div class="cells">
						{#each series[r.key] as v, i (i)}
							<span
								class="cal-cell"
								class:null={v === null}
								style={v === null ? '' : `background: rgba(11,29,58,${(v ?? 0) / 100})`}
								title={rollup?.dates[i]}
							></span>
						{/each}
					</div>
				</div>
			{/each}
		</section>
	{/if}

	<!-- Priority 3: stats + links, if space -->
	<!-- {#if current}
		<Separator />
		<section class="readout">
			{#each ROWS as r (r.key)}
				<div class="stat">
					<span class="lbl">{r.label}</span>
					<span class="val">{current[r.key]}</span>
				</div>
			{/each}
		</section>
	{/if} -->

	<footer class="links">
		<Button variant="link" size="xs" href={meteogramImageUrl(date, code)} target="_blank"
			>Raw meteogram ↗</Button
		>
		<Button variant="link" size="xs" onclick={copyPermalink}>{copied ? 'Copied ✓' : 'Copy link'}</Button
		>
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
	.head-right {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}
	.head-right :global(.streak) {
		font-family: var(--font-display);
		color: #b8860b;
		border-color: #b8860b;
		white-space: nowrap;
	}

	.meteogram {
		margin: 0;
	}
	.meteogram :global(canvas) {
		width: 100%;
		max-width: none;
	}
	figcaption {
		font-family: var(--font-display);
		font-size: 9px;
		letter-spacing: 0.03em;
		opacity: 0.6;
		margin-top: 5px;
	}
	.note {
		font-size: 13px;
		opacity: 0.7;
		padding: 24px 0;
		text-align: center;
	}

	.calendar h3 {
		font-family: var(--font-display);
		font-size: 11px;
		letter-spacing: 0.05em;
		margin: 0 0 6px;
	}
	.cal-row {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 2px;
	}
	.cal-label {
		font-family: var(--font-display);
		font-size: 10px;
		width: 10px;
	}
	.cells {
		display: flex;
		gap: 1px;
		background: var(--ink);
		padding: 1px;
		flex: 1;
	}
	.cal-cell {
		flex: 1;
		height: 11px;
		background: var(--paper);
	}
	.cal-cell.null {
		background-image: repeating-linear-gradient(
			45deg,
			#9aa7b4,
			#9aa7b4 2px,
			#c3ccd6 2px,
			#c3ccd6 4px
		);
	}

	.readout {
		display: flex;
		gap: 20px;
	}
	.stat {
		display: flex;
		flex-direction: column;
	}
	.lbl {
		font-family: var(--font-display);
		font-size: 10px;
		opacity: 0.6;
	}
	.val {
		font-family: var(--font-display);
		font-size: 24px;
		line-height: 1;
	}

	.links {
		display: flex;
		gap: 8px;
		align-items: center;
		justify-content: space-between;
	}
	.links :global(a),
	.links :global(button) {
		font-family: var(--font-display);
		font-size: 9px;
		letter-spacing: 0.03em;
		color: var(--ink);
		padding-left: 0;
		padding-right: 0;
	}
</style>
