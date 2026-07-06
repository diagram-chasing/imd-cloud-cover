<script lang="ts">
	import { onMount } from 'svelte';
	import type { Station } from '$lib/types';
	import { loadCore, type CoreData } from '$lib/api/load';
	import { sky } from '$lib/state/sky.svelte';
	import { computeValues, computePersistence, rollupForView } from '$lib/data';

	import PixelMap from '$lib/components/PixelMap.svelte';
	import TimeScrubber from '$lib/components/TimeScrubber.svelte';
	import WindowScrubber from '$lib/components/WindowScrubber.svelte';
	import BandToggle from '$lib/components/BandToggle.svelte';
	import ViewTabs from '$lib/components/ViewTabs.svelte';
	import StationTooltip from '$lib/components/StationTooltip.svelte';
	import HeadlineStat from '$lib/components/HeadlineStat.svelte';
	import SeasonalLens from '$lib/components/SeasonalLens.svelte';
	import StreakBoard from '$lib/components/StreakBoard.svelte';
	import StationSearch from '$lib/components/StationSearch.svelte';
	import StationPanel from '$lib/components/StationPanel.svelte';

	let core = $state<CoreData>();
	let error = $state<string | null>(null);

	const today = new Date().toISOString().slice(0, 10);
	let tip = $state<{ code: string; clientX: number; clientY: number } | null>(null);
	let mapSection = $state<HTMLElement>();

	// Afternoon-lens "WATCH IT": jump to today view and autoplay the scrub once.
	function watchAfternoon() {
		sky.setView('today');
		mapSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		sky.timeIndex = 3;
		sky.playing = true;
	}

	onMount(async () => {
		try {
			core = await loadCore();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load data';
		}
	});

	let activeRollup = $derived(rollupForView(sky.view, core?.rollup7, core?.rollup30));
	let values = $derived(
		computeValues(sky.view, core?.latest, activeRollup, sky.timeIndex, sky.windowDayIndex)
	);
	let persistence = $derived(computePersistence(activeRollup));

	let tipStation = $derived<Station | null>(
		tip && core ? (core.manifest.stations[tip.code] ?? null) : null
	);
	let tipValues = $derived(tip ? (values[tip.code] ?? null) : null);

	// Station panel.
	let panelStation = $derived<Station | null>(
		sky.selectedCode && core ? (core.manifest.stations[sky.selectedCode] ?? null) : null
	);
	function openStation(code: string) {
		sky.selectedCode = code;
	}
	function closePanel() {
		sky.selectedCode = null;
	}
</script>

<svelte:head>
	<title>Aaj Ka Aasmaan — India's Sky, Daily</title>
	<meta
		name="description"
		content="A daily pixel map of cloud cover over India, read from IMD meteograms."
	/>
</svelte:head>

<main>
	<header class="masthead">
		<span>AAJ KA AASMAAN · INDIA'S SKY, DAILY</span>
		<span class="mast-right">{core?.summary.date ?? today} · UPDATES DAILY 11:00 IST</span>
	</header>

	{#if error}
		<p class="error">Couldn’t load today’s sky: {error}</p>
	{/if}

	{#if core}
		<section class="hero-copy">
			<HeadlineStat summary={core.summary} {today} />
		</section>
	{/if}

	<!-- Accessible mirror of the map -->
	<p class="sr-only">
		Interactive pixel map of cloud cover over India.
		{#if core}{core.summary.station_count} stations; use the station search to explore.{/if}
	</p>

	<section class="map-block" bind:this={mapSection}>
		<div class="controls-top">
			<ViewTabs />
			{#if core}
				<StationSearch manifest={core.manifest} onselect={openStation} />
			{/if}
		</div>

		{#if core}
			<PixelMap
				india={core.india}
				manifest={core.manifest}
				{values}
				{persistence}
				onhover={(info) => (tip = info)}
				onselect={openStation}
			/>
		{:else if !error}
			<div class="loading">Reading the skies…</div>
		{/if}

		<div class="controls-under">
			{#if sky.view === 'today'}
				<TimeScrubber />
			{:else if activeRollup}
				<WindowScrubber dates={activeRollup.dates} />
			{/if}
			<BandToggle />
		</div>
	</section>

	{#if core}
		<SeasonalLens
			manifest={core.manifest}
			latest={core.latest}
			rollup7={core.rollup7}
			date={core.summary.date}
			onwatch={watchAfternoon}
		/>
	{/if}

	{#if core}
		<section class="streak-section">
			<h2>THE RECORD BOOKS</h2>
			<StreakBoard summary={core.summary} onselect={openStation} />
		</section>
	{/if}

	<!-- Method note -->
	<section class="method">
		<h2>HOW WE READ THE SKY</h2>
		<div class="method-grid">
			<figure>
				<img
					src="/method-meteogram.webp"
					alt="A sample IMD meteogram with the cloud panel highlighted"
				/>
				<figcaption>The cloud-cover panel of one station's meteogram.</figcaption>
			</figure>
			<div class="method-text">
				<p>
					A <strong>meteogram</strong> is a strip chart the India Meteorological Department
					publishes for each station — a 10-day forecast of cloud, rain, wind and temperature.
				</p>
				<p>
					Every day we download all {core?.manifest.count ?? '1,200+'} station meteograms and read the
					pixels of just the cloud-cover panel: three bands for high, middle and low cloud.
				</p>
				<p>
					What you see is the model's <strong>day-0 forecast</strong> — eight 3-hourly steps from
					midnight — not a satellite observation.
				</p>
			</div>
		</div>
	</section>

	<footer>
		<span>Data: IMD GFS meteograms · Not an official forecast.</span>
	</footer>
</main>

{#if tip && tipStation}
	<StationTooltip station={tipStation} values={tipValues} clientX={tip.clientX} clientY={tip.clientY} />
{/if}

<!-- Station drill-down slide-in -->
{#if panelStation && sky.selectedCode && core}
	<button class="scrim" aria-label="Close station panel" onclick={closePanel}></button>
	<aside class="slide-in">
		<StationPanel
			code={sky.selectedCode}
			station={panelStation}
			current={values[sky.selectedCode] ?? null}
			rollup={core.rollup30}
			date={core.summary.date}
			onclose={closePanel}
		/>
	</aside>
{/if}

<style>
	main {
		max-width: 1080px;
		margin: 0 auto;
		padding: 20px 20px 60px;
	}
	.masthead {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
		font-family: var(--font-display);
		font-size: 11px;
		letter-spacing: 0.05em;
		padding-bottom: 20px;
		border-bottom: 2px solid var(--ink);
	}
	.mast-right {
		opacity: 0.7;
	}
	.hero-copy {
		margin: 32px 0 24px;
	}
	.map-block {
		margin: 24px 0 48px;
	}
	.controls-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 16px;
		flex-wrap: wrap;
		margin-bottom: 12px;
	}
	.controls-under {
		display: flex;
		flex-wrap: wrap;
		gap: 20px;
		align-items: flex-end;
		margin-top: 16px;
	}
	.loading {
		aspect-ratio: 900 / 954;
		display: grid;
		place-items: center;
		background: #eef4fb;
		box-shadow: 0 0 0 2px var(--ink);
		font-family: var(--font-display);
		font-size: 12px;
	}
	.streak-section {
		margin: 48px 0;
		border-top: 2px solid var(--ink);
		padding-top: 24px;
	}
	.streak-section h2,
	.method h2 {
		font-family: var(--font-display);
		font-size: 20px;
		letter-spacing: 0.05em;
	}
	.method {
		margin-top: 48px;
		border-top: 2px solid var(--ink);
		padding-top: 24px;
	}
	.method-grid {
		display: grid;
		grid-template-columns: minmax(0, 320px) 1fr;
		gap: 24px;
		align-items: start;
	}
	figure {
		margin: 0;
	}
	.method figure img {
		width: 100%;
		box-shadow: 0 0 0 2px var(--ink);
		image-rendering: auto;
	}
	figcaption {
		font-size: 12px;
		opacity: 0.7;
		margin-top: 6px;
	}
	.method-text p {
		font-size: 15px;
		margin: 0 0 12px;
	}
	.error {
		font-family: var(--font-display);
		font-size: 12px;
		color: #b23a2a;
	}
	footer {
		margin-top: 48px;
		padding-top: 20px;
		border-top: 2px solid var(--ink);
		font-family: var(--font-display);
		font-size: 10px;
		letter-spacing: 0.05em;
		opacity: 0.7;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 45;
		background: rgba(11, 29, 58, 0.35);
		border: 0;
		cursor: pointer;
	}
	.slide-in {
		position: fixed;
		top: 0;
		right: 0;
		z-index: 46;
		width: 380px;
		max-width: 100vw;
		height: 100vh;
		background: var(--paper);
		box-shadow: -2px 0 0 0 var(--ink);
		animation: slide 150ms ease-out;
	}
	@keyframes slide {
		from {
			transform: translateX(100%);
		}
		to {
			transform: translateX(0);
		}
	}
	@media (max-width: 640px) {
		.method-grid {
			grid-template-columns: 1fr;
		}
		.slide-in {
			top: auto;
			bottom: 0;
			width: 100vw;
			height: 70vh;
			box-shadow: 0 -2px 0 0 var(--ink);
			animation: slideup 150ms ease-out;
		}
	}
	@keyframes slideup {
		from {
			transform: translateY(100%);
		}
		to {
			transform: translateY(0);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.slide-in {
			animation: none;
		}
	}
</style>
