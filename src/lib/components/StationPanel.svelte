<script lang="ts">
	import type { Station, Rollup, Forecast } from '$lib/types';
	import { fetchForecast, meteogramImageUrl } from '$lib/api/r2';
	import { CLEAR_STARS } from '$lib/theme';
	import StationMeteogram from './StationMeteogram.svelte';

	interface Props {
		code: string;
		station: Station;
		current: { h: number; m: number; l: number } | null;
		rollup: Rollup | null;
		date: string;
		variant?: 'panel' | 'page';
		onclose?: () => void;
	}
	let { code, station, current, rollup, date, variant = 'panel', onclose }: Props = $props();

	let forecast = $state<Forecast | null>(null);
	let forecastError = $state(false);
	let copied = $state(false);

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

	// Sky calendar rows from the 30-day rollup.
	const CAL_ROWS: { key: 'h' | 'm' | 'l'; label: string }[] = [
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
		const url = `${location.origin}/station/${code}`;
		try {
			await navigator.clipboard.writeText(url);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			copied = false;
		}
	}
</script>

<div class="panel" class:page={variant === 'page'} role="dialog" aria-label="{station.name} details">
	<header>
		<div>
			<h2>{station.name}</h2>
			{#if station.state}<p class="state">{station.state}</p>{/if}
		</div>
		{#if variant === 'panel'}
			<button class="close" aria-label="Close" onclick={() => onclose?.()}>✕</button>
		{/if}
	</header>

	{#if current}
		<div class="readout">
			{#each CAL_ROWS as r (r.key)}
				<div class="stat"><span class="lbl">{r.label}</span><span class="val">{current[r.key]}</span></div>
			{/each}
		</div>
	{/if}

	<div class="meteogram">
		{#if forecastError}
			<p class="note">Forecast chart unavailable.</p>
		{:else}
			<StationMeteogram {forecast} />
		{/if}
		<p class="cap">10-day forecast · 3-hourly · high / mid / low</p>
	</div>

	{#if series}
		<div class="calendar">
			<h3>SKY CALENDAR · {rollup?.window ?? 30} DAYS</h3>
			{#each CAL_ROWS as r (r.key)}
				<div class="cal-row">
					<span class="cal-label">{r.label}</span>
					<div class="cells">
						{#each series[r.key] as v, i (i)}
							<span
								class="cal-cell"
								class:null={v === null}
								style={v === null ? '' : `background: rgba(255,255,255,${v / 100})`}
								title={rollup?.dates[i]}
							></span>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{/if}

	{#if clearStreak > 0}
		<p class="streak">☀ {clearStreak} {clearStreak === 1 ? 'DAY' : 'DAYS'} CLEAR</p>
	{/if}

	<div class="links">
		<a href={meteogramImageUrl(date, code)} target="_blank" rel="noopener">RAW METEOGRAM ↗</a>
		<button class="copy" onclick={copyPermalink}>{copied ? 'COPIED ✓' : 'COPY LINK'}</button>
	</div>
</div>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		gap: 16px;
		background: var(--paper);
		color: var(--ink);
		padding: 20px;
		height: 100%;
		overflow-y: auto;
	}
	.panel.page {
		max-width: 480px;
		margin: 0 auto;
		box-shadow: 0 0 0 2px var(--ink);
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
	}
	h2 {
		font-family: var(--font-display);
		font-size: 18px;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		margin: 0;
	}
	.state {
		font-size: 13px;
		opacity: 0.7;
		margin: 2px 0 0;
	}
	.close {
		font-size: 16px;
		cursor: pointer;
		color: var(--ink);
		padding: 4px;
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
		font-size: 28px;
	}
	.calendar h3,
	.meteogram .cap,
	.cap {
		font-family: var(--font-display);
	}
	.calendar h3 {
		font-size: 12px;
		letter-spacing: 0.05em;
		margin: 0 0 8px;
	}
	.cal-row {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 3px;
	}
	.cal-label {
		font-family: var(--font-display);
		font-size: 10px;
		width: 12px;
	}
	.cells {
		display: flex;
		gap: 1px;
		background: var(--accent);
		padding: 1px;
		flex: 1;
	}
	.cal-cell {
		flex: 1;
		height: 12px;
		background: rgba(255, 255, 255, 0);
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
	.streak {
		font-family: var(--font-display);
		font-size: 13px;
		color: #b8860b;
		margin: 0;
	}
	.cap {
		font-size: 10px;
		opacity: 0.6;
		margin: 6px 0 0;
	}
	.links {
		display: flex;
		gap: 16px;
		align-items: center;
		margin-top: auto;
		padding-top: 12px;
	}
	.links a,
	.copy {
		font-family: var(--font-display);
		font-size: 10px;
		letter-spacing: 0.05em;
		color: var(--accent);
		cursor: pointer;
		text-decoration: none;
	}
	.note {
		font-size: 13px;
		opacity: 0.7;
	}
</style>
