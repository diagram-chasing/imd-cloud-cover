<script lang="ts">
	import { onMount } from 'svelte';
	import type { Station } from '$lib/types';
	import { loadCore, type CoreData } from '$lib/api/load';
	import { sky } from '$lib/state/sky.svelte';
	import { skyMode } from '$lib/theme';
	import { computeValues, computePersistence, rollupForView } from '$lib/data';

	import PixelMap, { type HoverInfo } from '$lib/components/PixelMap.svelte';
	import TimeDock from '$lib/components/TimeDock.svelte';
	import ViewTabs from '$lib/components/ViewTabs.svelte';
	import BandToggle from '$lib/components/BandToggle.svelte';
	import PersistToggle from '$lib/components/PersistToggle.svelte';
	import StationTooltip from '$lib/components/StationTooltip.svelte';
	import StreakBoard from '$lib/components/StreakBoard.svelte';
	import StreakPanel from '$lib/components/StreakPanel.svelte';
	import StationSearch from '$lib/components/StationSearch.svelte';
	import StationDetails from '$lib/components/StationDetails.svelte';
	import SupportCTA from '$lib/components/SupportCTA.svelte';
	import SiteFooter from '$lib/components/SiteFooter.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Drawer, DrawerContent } from '$lib/components/ui/drawer';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { PlusSignIcon, MinusSignIcon, Maximize01Icon } from '@hugeicons/core-free-icons';

	let core = $state<CoreData>();
	let error = $state<string | null>(null);

	let tip = $state<HoverInfo | null>(null);

	// Map instance API (zoom buttons live in the page's control rail) and the
	// camera-derived layout info the streak inset uses to claim gutter space.
	let map = $state<{ zoomIn: () => void; zoomOut: () => void; zoomReset: () => void }>();
	let layout = $state({ gutter: 0, zoomRatio: 1 });

	// Mobile chip trays.
	let streaksOpen = $state(false);

	// Pixel-boxed zoom/fit buttons: h-11 standalone matches the 44px rail height
	// of the bordered toggle groups. Corner chips (mobile top strip) stay 32px.
	const ctlClass =
		'size-11 rounded-none border-2 border-[var(--ink)] bg-[var(--paper)] text-[var(--ink)] shadow-none hover:bg-[var(--cloud-block)] hover:text-[var(--ink)]';
	const chipClass =
		'h-8 rounded-none border-2 border-[var(--ink)] bg-[var(--paper)] px-2.5 text-[10px] tracking-wider text-[var(--ink)] uppercase shadow-none [font-family:var(--font-display)] hover:bg-[var(--cloud-block)] hover:text-[var(--ink)]';

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
	// Aggregated marks carry their bin mean — show that, not the representative
	// station's own values, so the tooltip matches what the mark encodes.
	let tipValues = $derived(tip ? (tip.agg ?? values[tip.code] ?? null) : null);

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

<!-- Framed map: a full-width bordered panel on a thin paper mat. All controls sit
     on one bottom rail — WHAT (layers) · WHEN (time) · WHERE (find + zoom) — with
     the streak inset in the right sea gutter, mirroring the cartouche on the left.
     Bounded height so the page scrolls past it to the content. -->
<section class="stage">
	<div class="map-frame">
		<h1 class="sr-only">Reading the Clouds</h1>
		{#if core}
			<PixelMap
				bind:this={map}
				india={core.india}
				urban={core.urban}
				places={core.places}
				manifest={core.manifest}
				{values}
				{persistence}
				date={core.summary.date}
				onhover={(info) => (tip = info)}
				onselect={openStation}
				onlayout={(info) => (layout = info)}
			/>
		{:else if !error}
			<div class="loading">Reading the skies…</div>
		{/if}

		<!-- Streak leaderboard: collapsed tab / inset table in the right sea gutter. -->
		{#if core}
			<StreakPanel
				summary={core.summary}
				onselect={openStation}
				gutter={layout.gutter}
				zoomRatio={layout.zoomRatio}
			/>
		{/if}

		<!-- Mobile chrome: corner chips in the sky strip left of the landmass
		     (the cartouche parks itself top-right on narrow viewports). -->
		<div class="mobile-top">
			<div class="chips">
				{#if core}
					<Button variant="outline" class={chipClass} onclick={() => (streaksOpen = true)}
						>Streaks</Button
					>
					<StationSearch
						manifest={core.manifest}
						onselect={openStation}
						compact
						side="bottom"
						align="start"
					/>
				{/if}
			</div>
		</div>

		<!-- Mobile: pinch zooms, so the only navigation button is "fit". -->
		<div class="mobile-fit">
			<Button
				variant="outline"
				size="icon"
				class="size-8 rounded-none border-2 border-[var(--ink)] bg-[var(--paper)] text-[var(--ink)] shadow-none hover:bg-[var(--cloud-block)] hover:text-[var(--ink)]"
				aria-label="Reset view"
				onclick={() => map?.zoomReset()}
			>
				<HugeiconsIcon icon={Maximize01Icon} strokeWidth={2.5} />
			</Button>
		</div>

		<!-- Bottom rail: WHAT · WHEN · WHERE, one control height throughout. -->
		<div class="bar bottom">
			<div class="lane legend">
				<BandToggle />
				{#if sky.view !== 'today'}<PersistToggle />{/if}
			</div>
			<div class="lane dock">
				<!-- Phones: compact layers + collapsed view picker ride above the scrubber. -->
				<div class="mobile-row">
					<BandToggle compact />
					<ViewTabs compact />
					{#if sky.view !== 'today'}<PersistToggle />{/if}
				</div>
				<TimeDock dates={activeRollup?.dates ?? null} />
			</div>
			<div class="lane where">
				{#if core}
					<StationSearch manifest={core.manifest} onselect={openStation} side="top" align="end" />
				{/if}
				<Button
					variant="outline"
					size="icon"
					class={ctlClass}
					aria-label="Zoom out"
					onclick={() => map?.zoomOut()}
				>
					<HugeiconsIcon icon={MinusSignIcon} strokeWidth={2.5} />
				</Button>
				<Button
					variant="outline"
					size="icon"
					class={ctlClass}
					aria-label="Zoom in"
					onclick={() => map?.zoomIn()}
				>
					<HugeiconsIcon icon={PlusSignIcon} strokeWidth={2.5} />
				</Button>
				<Button
					variant="outline"
					size="icon"
					class={ctlClass}
					aria-label="Reset view"
					onclick={() => map?.zoomReset()}
				>
					<HugeiconsIcon icon={Maximize01Icon} strokeWidth={2.5} />
				</Button>
			</div>
		</div>

		{#if error}<p class="error">Couldn’t load today’s sky: {error}</p>{/if}

		<p class="sr-only">
			Interactive pixel map of cloud cover over India.
			{#if core}{core.summary.station_count} stations; use the station search to explore.{/if}
		</p>
	</div>
</section>

<!-- Mobile streaks: the chip opens the same drawer idiom as the station card. -->
{#if core}
	<Drawer bind:open={streaksOpen} shouldScaleBackground={false}>
		<DrawerContent
			class="max-h-[85vh] gap-0 border-0 bg-[var(--paper)] p-4 pt-2 text-[var(--ink)] before:border-2 before:border-[var(--ink)] before:bg-[var(--paper)]"
		>
			<div class="sheet-scroll">
				<h2 class="drawer-title">STATION STREAKS</h2>
				<p class="drawer-caption">CONSECUTIVE CLEAR / OVERCAST DAYS</p>
				<StreakBoard
					summary={core.summary}
					onselect={(code) => {
						streaksOpen = false;
						openStation(code);
					}}
				/>
			</div>
		</DrawerContent>
	</Drawer>
{/if}

<!-- Short scroll below the map: purely explanation. -->
<div class="content">
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
			<a
				class="m-link"
				href="https://github.com/diagram-chasing"
				target="_blank"
				rel="noopener noreferrer">GitHub Action</a
			>
			(11:00 IST) downloads every station's meteogram, pixel-extracts the cloud-cover panel, and keeps
			the day-0 slice — the first eight three-hourly steps. Those readings, split into high cirrus, mid
			alto and low cumulus bands, are aggregated into the static JSON views this site loads.
		</p>
		<p>
			The site is built with
			<a
				class="m-link"
				href="https://svelte.dev/docs/kit/introduction"
				target="_blank"
				rel="noopener noreferrer">SvelteKit</a
			>
			and Svelte 5 runes. The map is projected with
			<a class="m-link" href="https://d3js.org/d3-geo" target="_blank" rel="noopener noreferrer"
				>D3</a
			>
			and rendered as an interactive pixel field with
			<a class="m-link" href="https://pixijs.com" target="_blank" rel="noopener noreferrer"
				>PixiJS</a
			>: each station becomes a three-mark cloud tower, and the grid subdivides toward individual
			stations as you zoom in. The full pipeline and source are open on
			<a
				class="m-link"
				href="https://github.com/diagram-chasing"
				target="_blank"
				rel="noopener noreferrer">GitHub</a
			>.
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
		members={tip.members}
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
		min-height: max(90svh, 440px); /* mobile: never let the map get cramped */
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
	/* One rail, three lanes: WHAT (band legend, left) · WHEN (time dock, centre) ·
	   WHERE (search + zoom, right). Grid keeps the dock optically centred. */
	.bar.bottom {
		bottom: 0;
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: end;
		gap: 12px 20px;
	}
	.lane {
		display: flex;
		min-width: 0;
	}
	.lane.legend {
		justify-self: start;
		align-items: center;
		gap: 8px;
	}
	.lane.dock {
		justify-self: center;
		flex-direction: column;
		align-items: center;
		gap: 8px;
	}
	.lane.where {
		justify-self: end;
		align-items: center;
		gap: 4px;
	}
	/* Phones only: compact layers + collapsed view picker above the scrubber. */
	.mobile-row {
		display: none;
		align-items: center;
		gap: 8px;
	}

	/* Mobile chrome: chips in the sky strip, fit button in the sea corner.
	   Hidden on desktop where the bottom rail carries everything. */
	.mobile-top {
		position: absolute;
		top: 0;
		left: 0;
		display: none;
		padding: 10px 12px;
		z-index: 10;
	}
	.chips {
		display: flex;
		gap: 6px;
	}
	.mobile-fit {
		position: absolute;
		right: 12px;
		bottom: 130px; /* clear the two-row mobile dock */
		display: none;
		z-index: 10;
	}
	.sheet-scroll {
		overflow-y: auto;
		max-height: calc(85vh - 40px);
	}
	.drawer-title {
		margin: 4px 0 2px;
		font-family: var(--font-display);
		font-size: 14px;
		letter-spacing: 0.08em;
	}
	.drawer-caption {
		margin: 0 0 12px;
		font-family: var(--font-display);
		font-size: 9px;
		letter-spacing: 0.06em;
		opacity: 0.6;
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
	/* Tablets: keep all three lanes but stack them, dock first. */
	@media (max-width: 1023px) and (min-width: 768px) {
		.bar.bottom {
			grid-template-columns: 1fr;
			justify-items: center;
			gap: 10px;
		}
		.lane.dock {
			order: -1;
		}
		.lane.legend,
		.lane.where {
			justify-self: center;
		}
	}
	/* Phones: the dock keeps time + compact layers + collapsed view picker;
	   everything else moves to the corner chips / fit button. */
	@media (max-width: 767px) {
		.bar.bottom {
			grid-template-columns: 1fr;
			justify-items: center;
		}
		.lane.legend,
		.lane.where {
			display: none;
		}
		.mobile-row {
			display: flex;
		}
		.mobile-top,
		.mobile-fit {
			display: flex;
		}
	}
	@media (max-width: 640px) {
		.method-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
