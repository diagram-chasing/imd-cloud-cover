<script lang="ts">
	import { onMount } from 'svelte';
	import type { Station } from '$lib/types';
	import { loadCore, type CoreData } from '$lib/api/load';
	import { sky } from '$lib/state/sky.svelte';
	import { skyMode } from '$lib/theme';
	import { computeValues, computePersistence, rollupForView } from '$lib/data';

	import PixelMap from '$lib/components/PixelMap.svelte';
	import TimeDock from '$lib/components/TimeDock.svelte';
	import BandToggle from '$lib/components/BandToggle.svelte';
	import StationTooltip from '$lib/components/StationTooltip.svelte';
	import HeadlineStat from '$lib/components/HeadlineStat.svelte';
	import SeasonalLens from '$lib/components/SeasonalLens.svelte';
	import StreakBoard from '$lib/components/StreakBoard.svelte';
	import StationSearch from '$lib/components/StationSearch.svelte';
	import StationDetails from '$lib/components/StationDetails.svelte';
	import SupportCTA from '$lib/components/SupportCTA.svelte';
	import SiteFooter from '$lib/components/SiteFooter.svelte';

	let core = $state<CoreData>();
	let error = $state<string | null>(null);

	const today = new Date().toISOString().slice(0, 10);
	let tip = $state<{ code: string; clientX: number; clientY: number } | null>(null);
	let stage = $state<HTMLElement>();

	// Afternoon-lens "WATCH IT": jump to today view and autoplay the scrub once.
	function watchAfternoon() {
		sky.setView('today');
		stage?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

	let panelStation = $derived<Station | null>(
		sky.selectedCode && core ? (core.manifest.stations[sky.selectedCode] ?? null) : null
	);
	// Screen point the desktop popover anchors to (the click); null for search/streak.
	let anchorPoint = $state<{ x: number; y: number } | null>(null);
	function openStation(code: string, at?: { x: number; y: number }) {
		anchorPoint = at ?? null;
		sky.selectedCode = code;
	}
	function closePanel() {
		sky.selectedCode = null;
	}

	// Follow the map's sky: at night the whole page (paper mat + content below) goes
	// dark to match the navy canvas, by overriding the paper/ink tokens on the root.
	$effect(() => {
		const night = skyMode(sky.timeIndex) === 'night';
		document.documentElement.classList.toggle('night', night);
		return () => document.documentElement.classList.remove('night');
	});
</script>

<svelte:head>
	<title>Reading The Clouds</title>
	<meta
		name="description"
		content="A daily pixel map of cloud cover over India, read from IMD meteograms."
	/>
</svelte:head>

<!-- Framed map: a full-width bordered panel on a thin paper mat. Controls are
     overlaid on the map itself (top: search · bottom: legend + dock · zoom in the
     canvas corner). Bounded height so the page scrolls past it to the content. -->
<section class="stage" bind:this={stage}>
	<div class="map-frame">
		<h1 class="sr-only">Reading the Clouds</h1>
		{#if core}
			<PixelMap
				india={core.india}
				urban={core.urban}
				places={core.places}
				manifest={core.manifest}
				{values}
				{persistence}
				date={core.summary.date}
				onhover={(info) => (tip = info)}
				onselect={openStation}
			/>
		{:else if !error}
			<div class="loading">Reading the skies…</div>
		{/if}

		<!-- top overlay: place search -->
		<div class="bar top">
			<div class="bar-right">
				{#if core}<StationSearch manifest={core.manifest} onselect={openStation} />{/if}
			</div>
		</div>

		<!-- bottom overlay: legend · time dock · (zoom lives in the canvas corner) -->
		<div class="bar bottom">
			<div class="lane legend"><BandToggle /></div>
			<div class="lane dock"><TimeDock dates={activeRollup?.dates ?? null} /></div>
			<div class="lane" aria-hidden="true"></div>
		</div>

		{#if error}<p class="error">Couldn’t load today’s sky: {error}</p>{/if}

		<p class="sr-only">
			Interactive pixel map of cloud cover over India.
			{#if core}{core.summary.station_count} stations; use the station search to explore.{/if}
		</p>
	</div>
</section>

<!-- Short scroll below the map -->
<div class="content">
	{#if core}
		<section class="streak-section">
			<StreakBoard summary={core.summary} onselect={openStation} />
		</section>
	{/if}

	<section class="method">
		<h2>HOW TO READ THE CLOUDS</h2>
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
					A <strong>meteogram</strong> is a strip chart the India Meteorological Department publishes
					for each station for a 10-day forecast of cloud, rain, wind and temperature.
				</p>
			</div>
		</div>
	</section>

	<section class="methodology">
		<h2>METHODOLOGY</h2>
		<p>
			Every morning the India Meteorological Department publishes a GFS <em>meteogram</em> for each
			of its ~1,200 observation stations. A daily
			<a class="m-link" href="https://github.com/diagram-chasing" target="_blank" rel="noopener noreferrer">GitHub Action</a>
			(11:00 IST) downloads every station's meteogram, pixel-extracts the cloud-cover panel, and
			keeps the day-0 slice — the first eight three-hourly steps. Those readings, split into high
			cirrus, mid alto and low cumulus bands, are aggregated into the static JSON views this site
			loads.
		</p>
		<p>
			The site is built with
			<a class="m-link" href="https://svelte.dev/docs/kit/introduction" target="_blank" rel="noopener noreferrer">SvelteKit</a>
			and Svelte 5 runes. The map is projected with
			<a class="m-link" href="https://d3js.org/d3-geo" target="_blank" rel="noopener noreferrer">D3</a>
			and rendered as an interactive pixel field with
			<a class="m-link" href="https://pixijs.com" target="_blank" rel="noopener noreferrer">PixiJS</a>:
			each station becomes a three-mark cloud tower, and the grid subdivides toward individual
			stations as you zoom in. The full pipeline and source are open on
			<a class="m-link" href="https://github.com/diagram-chasing" target="_blank" rel="noopener noreferrer">GitHub</a>.
		</p>
		<h2>AI DECLARATION</h2>
		<p>
			No prose on this site was generated by AI. Claude was used for coding assistance, so internal
			logic, layout maths and scripts may be partially LLM-generated.
		</p>
	</section>

	<section class="support-band">
		<SupportCTA />
	</section>
</div>

<SiteFooter />

{#if tip && tipStation}
	<StationTooltip
		station={tipStation}
		values={tipValues}
		clientX={tip.clientX}
		clientY={tip.clientY}
	/>
{/if}

{#if panelStation && sky.selectedCode && core}
	<StationDetails
		code={sky.selectedCode}
		station={panelStation}
		current={values[sky.selectedCode] ?? null}
		rollup={core.rollup30}
		date={core.summary.date}
		at={anchorPoint}
		onclose={closePanel}
	/>
{/if}

<style>
	/* Thin paper mat so the frame border reads; the map goes as wide as the mat allows.
	   On desktop the mat fills the first screen (map height driven by it) so the page
	   scrolls past to the content; on mobile the map keeps a tall min-height and the
	   section grows in normal flow. */
	.stage {
		box-sizing: border-box;
		padding: clamp(8px, 1.4vw, 18px);
		background: var(--paper);
		transition: background-color 0.4s ease;
	}
	.map-frame {
		position: relative;
		overflow: hidden;
		border: 0px solid var(--ink);
		background: #0b1d3a; /* navy sky behind the canvas while it loads */
		min-height: max(60svh, 440px); /* mobile: never let the map get cramped */
	}
	@media (min-width: 768px) {
		.stage {
			height: 100svh;
		}
		.map-frame {
			height: 100%;
			min-height: 0;
		}
	}

	/* Overlaid control bars, pinned to the map's own edges inside the frame. */
	.bar {
		position: absolute;
		left: 0;
		right: 0;
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 14px 16px;
		pointer-events: none;
		z-index: 10;
	}
	.bar :global(*) {
		pointer-events: auto;
	}
	.bar.top {
		top: 0;
		/* background: linear-gradient(rgba(11, 29, 58, 0.45), transparent); */
	}
	/* Three lanes: band legend (left), time dock (centre), and an empty right lane the
	   canvas zoom controls float over. Grid keeps the dock optically centred. */
	.bar.bottom {
		bottom: 0;
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: end;
		gap: 12px 20px;
		padding-right: 60px; /* clear the corner zoom buttons */
		/* background: linear-gradient(transparent, rgba(11, 29, 58, 0.55)); */
	}
	.lane {
		display: flex;
		min-width: 0;
	}
	.lane.legend {
		justify-self: start;
	}
	.lane.dock {
		justify-self: center;
	}
	.bar-right {
		margin-left: auto;
	}
	/* keep the overlaid search legible on the sky */
	.bar-right :global(label) {
		color: #fff;
	}

	.loading {
		width: 100%;
		height: 100%;
		display: grid;
		place-items: center;
		color: #fff;
		font-family: var(--font-display);
		font-size: 12px;
	}
	.error {
		position: absolute;
		top: 60px;
		left: 16px;
		font-family: var(--font-display);
		font-size: 12px;
		color: #ffd7cf;
		z-index: 11;
	}

	.content {
		max-width: 1080px;
		margin: 0 auto;
		padding: 40px 20px 60px;
	}

	.streak-section {
		margin: 48px 0;
	}
	.streak-section h2,
	.method h2,
	.methodology h2 {
		font-family: var(--font-display);
		font-size: 20px;
		letter-spacing: 0.05em;
	}
	.method {
		margin-top: 48px;
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

	.methodology {
		margin-top: 56px;
		max-width: 680px;
	}
	.methodology h2 {
		margin: 0 0 12px;
	}
	.methodology h2 + p ~ h2 {
		margin-top: 32px;
	}
	.methodology p {
		font-size: 14px;
		line-height: 1.7;
		margin: 0 0 14px;
		color: var(--muted-foreground);
		text-wrap: pretty;
	}
	.m-link {
		color: var(--ink);
		text-decoration: underline;
		text-underline-offset: 3px;
		transition: color 0.12s;
	}
	.m-link:hover {
		color: var(--focus);
	}

	.support-band {
		margin-top: 64px;
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
	@media (max-width: 900px) {
		/* Stack the bottom controls: dock first, legend below, no corner overlap. */
		.bar.bottom {
			grid-template-columns: 1fr;
			justify-items: center;
			padding-right: 16px;
			padding-bottom: 56px;
		}
		.lane.dock {
			order: -1;
		}
		.lane.legend {
			justify-self: center;
		}
		.lane[aria-hidden='true'] {
			display: none;
		}
	}
	@media (max-width: 640px) {
		.method-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
