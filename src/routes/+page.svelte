<script lang="ts">
	import { onMount } from 'svelte';
	import type { Topology } from 'topojson-specification';
	import type { FeatureCollection } from 'geojson';
	import type { StationsManifest, AllStations, Summary, Station } from '$lib/types';
	import { fetchStations, fetchLatest, fetchSummary } from '$lib/api/r2';
	import { topoToIndia } from '$lib/map/projection';
	import { sky } from '$lib/state/sky.svelte';
	import type { BandValues } from '$lib/map/render';

	import PixelMap from '$lib/components/PixelMap.svelte';
	import TimeScrubber from '$lib/components/TimeScrubber.svelte';
	import BandToggle from '$lib/components/BandToggle.svelte';
	import StationTooltip from '$lib/components/StationTooltip.svelte';
	import HeadlineStat from '$lib/components/HeadlineStat.svelte';

	let india = $state<FeatureCollection>();
	let manifest = $state<StationsManifest>();
	let latest = $state<AllStations>();
	let summary = $state<Summary>();
	let error = $state<string | null>(null);

	const today = new Date().toISOString().slice(0, 10);

	// Tooltip state.
	let tip = $state<{ code: string; clientX: number; clientY: number } | null>(null);

	onMount(async () => {
		try {
			const [topo, m, l, s] = await Promise.all([
				fetch('/data/india.json').then((r) => r.json() as Promise<Topology>),
				fetchStations(),
				fetchLatest(),
				fetchSummary()
			]);
			india = topoToIndia(topo);
			manifest = m;
			latest = l;
			summary = s;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load data';
		}
	});

	// Per-station cover at the current time step (TODAY view).
	let values = $derived.by<BandValues>(() => {
		const out: BandValues = {};
		if (!latest) return out;
		const ti = sky.timeIndex;
		for (const [code, b] of Object.entries(latest.stations)) {
			out[code] = { h: b.h[ti] ?? 0, m: b.m[ti] ?? 0, l: b.l[ti] ?? 0 };
		}
		return out;
	});

	let tipStation = $derived<Station | null>(
		tip && manifest ? (manifest.stations[tip.code] ?? null) : null
	);
	let tipValues = $derived(tip ? (values[tip.code] ?? null) : null);

	function onselect() {
		// Station panel arrives in Phase 3; for now selection lives in sky state.
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
		<span class="mast-right">{summary?.date ?? today} · UPDATES DAILY 11:00 IST</span>
	</header>

	{#if error}
		<p class="error">Couldn’t load today’s sky: {error}</p>
	{/if}

	{#if summary}
		<section class="hero-copy">
			<HeadlineStat {summary} {today} />
		</section>
	{/if}

	<section class="map-block">
		<div class="controls-top">
			<span class="view-label">TODAY</span>
		</div>

		{#if india && manifest}
			<PixelMap {india} {manifest} {values} onhover={(info) => (tip = info)} {onselect} />
		{:else if !error}
			<div class="loading">Reading the skies…</div>
		{/if}

		<div class="controls-under">
			<TimeScrubber />
			<BandToggle />
		</div>
	</section>

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
					Every day we download all {manifest?.count ?? '1,200+'} station meteograms and read the
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
		margin-bottom: 12px;
	}
	.view-label {
		font-family: var(--font-display);
		font-size: 14px;
		background: var(--ink);
		color: var(--ink-on-dark);
		padding: 4px 8px;
		letter-spacing: 0.05em;
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
	.method {
		margin-top: 48px;
		border-top: 2px solid var(--ink);
		padding-top: 24px;
	}
	.method h2 {
		font-family: var(--font-display);
		font-size: 20px;
		letter-spacing: 0.05em;
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
	@media (max-width: 640px) {
		.method-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
