<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import type { Station } from '$lib/types';
	import { loadCore, type CoreData } from '$lib/api/load';
	import { CORE_BASE } from '$lib/api/r2';
	import { sky } from '$lib/state/sky.svelte';
	import { skyMode } from '$lib/theme';
	import { computeValues, rollupForView } from '$lib/data';
	import { click } from '$lib/feedback';

	import PixelMap, { type HoverInfo } from '$lib/components/PixelMap.svelte';
	import TimeDock from '$lib/components/TimeDock.svelte';
	import ViewTabs from '$lib/components/ViewTabs.svelte';
	import BandToggle from '$lib/components/BandToggle.svelte';
	import StationTooltip from '$lib/components/StationTooltip.svelte';
	import StreakBoard from '$lib/components/StreakBoard.svelte';
	import StreakPanel from '$lib/components/StreakPanel.svelte';
	import StationSearch from '$lib/components/StationSearch.svelte';
	import StationDetails from '$lib/components/StationDetails.svelte';
	import Minimap from '$lib/components/Minimap.svelte';
	import SupportCTA from '$lib/components/SupportCTA.svelte';
	import SiteFooter from '$lib/components/SiteFooter.svelte';
	import { Button } from '$lib/components/ui/button';

	let core = $state<CoreData>();
	let error = $state<string | null>(null);

	let tip = $state<HoverInfo | null>(null);

	// Map instance API (the FIT link calls it) and the camera-derived layout info
	// the streak inset + FIT link use: gutter width and zoom-vs-fit ratio.
	let map = $state<{
		zoomIn: () => void;
		zoomOut: () => void;
		zoomReset: () => void;
		panAside: (on: boolean, clearPx?: number) => void;
	}>();
	let layout = $state({
		gutter: 0,
		zoomRatio: 1,
		view: { x: 0, y: 0, w: 0, h: 0 },
		world: { w: 1, h: 1 },
		streak: { x: 0, y: 0 }
	});
	// Phones get the pan-aside + minimap streak reveal; desktop keeps the gutter list.
	let isPhone = $state(false);
	$effect(() => {
		const mq = window.matchMedia('(max-width: 767px)');
		isPhone = mq.matches;
		const on = () => (isPhone = mq.matches);
		mq.addEventListener('change', on);
		return () => mq.removeEventListener('change', on);
	});
	// Glide the map into open ocean while the phone streaks overlay is up, panning
	// India's tip up by exactly the space the board needs (measured) + padding, so
	// it clears the land without wasting sea.
	const STREAK_PAD = 16; // gap between the landmass and the board
	const CONTROLS_RESERVE = 140; // space the bottom control rail occupies
	let boardH = $state(0); // measured height of the streak board
	let streakClearPx = $derived(boardH + STREAK_PAD + CONTROLS_RESERVE);
	$effect(() => {
		map?.panAside(sky.showStreaks && isPhone, streakClearPx);
	});
	// Scroll/pinch does the zooming; chrome appears only when there's a way back.
	let zoomed = $derived(layout.zoomRatio > 1.05);

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

	// The single "when am I looking at" answer, derived from the scrub state so the
	// cartouche, tooltip and station card all agree. In today view the date is fixed
	// and the time steps; in week/month the date is the scrubbed window day and the
	// reading is a daily mean.
	const HOUR_LABELS = ['00', '03', '06', '09', '12', '15', '18', '21'];
	let activeDate = $derived.by(() => {
		if (!core) return '';
		if (sky.view === 'today') return core.summary.date;
		const dates = activeRollup?.dates;
		if (!dates?.length) return core.summary.date;
		return dates[Math.min(sky.windowDayIndex, dates.length - 1)] ?? core.summary.date;
	});
	let whenLabel = $derived(
		sky.view === 'today' ? `${HOUR_LABELS[sky.timeIndex]}:00 IST` : 'DAILY MEAN'
	);
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

	// Light "open" click for chrome that appears: the streaks reveal and a chosen
	// search result. (Map taps get their own firmer click inside PixelMap.)
	function toggleStreaks() {
		click('open');
		sky.showStreaks = !sky.showStreaks;
	}
	function selectFromSearch(code: string) {
		click('open');
		openStation(code);
	}

	let night = $derived(skyMode(sky.timeIndex) === 'night');

	// Follow the map's sky: at night the whole page (paper mat + content below) goes
	// dark to match the navy canvas, by overriding the paper/ink tokens on the root.
	$effect(() => {
		document.documentElement.classList.toggle('night', night);
		return () => document.documentElement.classList.remove('night');
	});

	// Everything loadCore() fetches, preloaded from the prerendered <head> so the
	// browser pulls the data in parallel with the JS bundle instead of waiting
	// for hydration + onMount. Hrefs must match the fetch URLs exactly.
	const preloads = [
		'/data/india.json',
		'/data/india-places.json',
		`${CORE_BASE}/meta/stations.json`,
		`${CORE_BASE}/latest/all-stations.json`,
		`${CORE_BASE}/latest/summary.json`,
		`${CORE_BASE}/rollups/7d.json`,
		`${CORE_BASE}/rollups/30d.json`
	];
</script>

<svelte:head>
	<title>Reading The Clouds</title>
	<meta
		name="description"
		content="A daily pixel map of cloud cover over India, read from IMD meteograms."
	/>
	{#each preloads as href (href)}
		<link rel="preload" {href} as="fetch" crossorigin="anonymous" />
	{/each}
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
				places={core.places}
				manifest={core.manifest}
				{values}
				date={activeDate}
				onhover={(info) => (tip = info)}
				onselect={openStation}
				onlayout={(info) => (layout = info)}
			/>
		{:else if !error}
			<div class="loading">Reading the skies…</div>
		{/if}

		<!-- Desktop: while zoomed/panned, a corner minimap shows where the viewport sits
		     over India (and how far it's drifted into the sea). Phones use the pan-aside
		     streak reveal instead, so this is desktop-only. -->
		{#if core && zoomed && !isPhone}
			<div class="minimap-corner" transition:fade={{ duration: 160 }}>
				<Minimap view={layout.view} world={layout.world} {night} />
			</div>
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
					<Button
						variant="outline"
						class={chipClass}
						aria-pressed={sky.showStreaks}
						onclick={toggleStreaks}>Streaks</Button
					>
					<StationSearch
						manifest={core.manifest}
						places={core.places}
						onselect={selectFromSearch}
						compact
						side="bottom"
						align="start"
					/>
				{/if}
			</div>
		</div>

		<!-- Bottom rail: WHAT (legend) · WHEN (timeline) · WHERE (find + fit).
		     Quiet chrome: the legend and switchers are typography on the sky;
		     the search trigger is the only boxed control. -->
		<div class="bar bottom">
			<div class="lane legend">
				<BandToggle />
			</div>
			<div class="lane dock">
				<!-- Phones: the legend compresses to one glyph row above the timeline,
				     with the fit-map icon tucked to its right. -->
				<div class="mobile-row">
					<BandToggle horizontal />
					{#if zoomed}
						<button class="fit fit-icon" aria-label="Fit map" onclick={() => map?.zoomReset()}
							>↺</button
						>
					{/if}
				</div>
				<TimeDock dates={activeRollup?.dates ?? null} />
			</div>
			<div class="lane where">
				{#if zoomed}
					<button class="fit" onclick={() => map?.zoomReset()}>↺ FIT MAP</button>
				{/if}
				{#if core}
					<button
						class="streaks-toggle"
						class:on={sky.showStreaks}
						aria-pressed={sky.showStreaks}
						onclick={toggleStreaks}>STREAKS</button
					>
					<StationSearch
						manifest={core.manifest}
						places={core.places}
						onselect={selectFromSearch}
						compact
						side="top"
						align="end"
					/>
				{/if}
			</div>
		</div>

		{#if error}<p class="error">Couldn’t load today’s sky: {error}</p>{/if}

		<p class="sr-only">
			Interactive pixel map of cloud cover over India.
			{#if core}{core.summary.station_count} stations; use the station search to explore.{/if}
		</p>

		<!-- Phone streaks: the board lives out in the open sea south of India. The map
		     glides south (see PixelMap.panAside) and this world-anchored board slides
		     up into view with the sea — same sky-typography as the desktop gutter list.
		     The minimap shows the viewport having moved off India onto the board. -->
		{#if core && sky.showStreaks}
			<div
				class="streaks-scene"
				role="dialog"
				aria-modal="true"
				aria-label="Station streaks"
				tabindex="-1"
				transition:fade={{ duration: 160 }}
				onkeydown={(e) => {
					if (e.key === 'Escape') sky.showStreaks = false;
				}}
			>
				<!-- Tap the open sea to dismiss (the STREAKS toggle does the same). -->
				<button class="sea-dismiss" aria-label="Close streaks" onclick={() => (sky.showStreaks = false)}
				></button>

				<!-- A small dense leaderboard seated in the open sea just below the panned
				     landmass, above the control rail. Its measured height drives exactly
				     how far the map pans. No close/minimap chrome — scenery. -->
				<div class="streak-dock">
					<div class="streak-world" bind:clientHeight={boardH}>
						<h2 class="streak-title">STATION STREAKS</h2>
						<p class="streak-caption">CONSECUTIVE CLEAR / OVERCAST DAYS</p>
						<StreakBoard
							summary={core.summary}
							compact
							limit={5}
							onselect={(code) => {
								sky.showStreaks = false;
								openStation(code);
							}}
						/>
					</div>
				</div>
			</div>
		{/if}
	</div>
</section>

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
		date={activeDate}
		when={whenLabel}
	/>
{/if}

{#if panelStation && sky.selectedCode && core}
	<StationDetails
		code={sky.selectedCode}
		station={panelStation}
		current={values[sky.selectedCode] ?? null}
		rollup={core.rollup30}
		date={activeDate}
		when={whenLabel}
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
		/* Definite height (not just min-height) so the canvas fills the frame on
		   mobile too — otherwise the solid navy fallback shows behind the controls
		   instead of the sea + gradient scrim the way it does on desktop. */
		height: max(90svh, 440px);
	}
	/* Edge scrim: an eased deep-sky wash under the control rail so the white
	   chrome keeps a contrast floor whatever the map draws beneath it. Tinted
	   with the scene's own navy it reads as sea depth, not as a UI panel. */
	.map-frame::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 170px;
		pointer-events: none;
		z-index: 9; /* just under the control bars (z-index 10) */
		background: linear-gradient(
			to top,
			rgba(8, 24, 49, 0.6),
			rgba(8, 24, 49, 0.42) 35%,
			rgba(8, 24, 49, 0.18) 65%,
			transparent
		);
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
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
	}
	.lane.dock {
		justify-self: center;
		flex-direction: column;
		align-items: flex-start;
		gap: 8px;
	}
	.lane.where {
		justify-self: end;
		align-items: center;
		gap: 12px;
	}
	/* Quiet "way back": appears only while the view is actually zoomed. */
	.fit {
		padding: 2px 4px;
		font-family: var(--font-display);
		font-size: 11px;
		letter-spacing: 0.08em;
		color: #fff;
		opacity: 0.8;
		cursor: pointer;
		text-shadow: 1px 1px 0 rgba(11, 29, 58, 0.9);
	}
	.fit:hover {
		opacity: 1;
	}
	.fit:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
	/* Phones only: the legend compresses to one glyph row above the timeline, with
	   the fit-map icon tucked to the right without shifting the centred glyphs. */
	.mobile-row {
		display: none;
		position: relative;
		align-items: center;
		justify-content: center;
		gap: 12px;
	}
	.fit-icon {
		position: absolute;
		right: 0;
		padding: 0 4px;
		font-size: 15px;
		line-height: 1;
	}

	/* Mobile chrome: chips in the sky strip. Hidden on desktop where the bottom
	   rail carries everything. */
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
	/* Quiet text toggle in the WHERE lane, voiced like ViewTabs: recedes at rest,
	   brightens on hover, underlines when the streaks are shown. */
	.streaks-toggle {
		padding: 0;
		font-family: var(--font-display);
		font-size: 11px;
		letter-spacing: 0.08em;
		color: #fff;
		opacity: 0.55;
		cursor: pointer;
		text-shadow: 1px 1px 0 rgba(11, 29, 58, 0.9);
	}
	.streaks-toggle:hover {
		opacity: 0.9;
	}
	.streaks-toggle.on {
		opacity: 1;
		text-decoration: underline;
		text-underline-offset: 3px;
		text-decoration-thickness: 2px;
	}
	.streaks-toggle:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}

	/* Phone streaks: a scene bounded to the map area. The board itself is pinned to
	   a world anchor out in the open sea and slides in with the camera pan; the same
	   white sky-typography as the desktop gutter list. No scrim/panel — it reads as
	   part of the world, not a sheet on top. --ink flips the board text white. */
	.streaks-scene {
		position: absolute;
		inset: 0;
		z-index: 20;
		display: none;
		--ink: #ffffff;
		color: #fff;
	}
	/* Transparent catch-all: tap the open sea to dismiss. */
	.sea-dismiss {
		position: absolute;
		inset: 0;
		border: 0;
		background: transparent;
		cursor: pointer;
	}
	/* The board sits in the empty sea between the panned landmass and the control
	   rail, auto-centered with padding. Bounds tuned to the aside pan. */
	/* Board seats just above the control rail; the map pans so the land sits a pad
	   above it (bottom must match CONTROLS_RESERVE in the script). */
	.streak-dock {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 140px;
		display: flex;
		justify-content: center;
		padding: 0 14px;
		pointer-events: none;
	}
	.streak-world {
		width: min(88vw, 340px);
		text-shadow: 1px 1px 0 rgba(11, 29, 58, 0.9);
		pointer-events: none; /* empty areas fall through to the sea to dismiss */
	}
	.streak-world :global(li button) {
		pointer-events: auto;
		text-shadow: 1px 1px 0 rgba(11, 29, 58, 0.9);
	}
	.streak-world :global(li button:hover) {
		background: rgba(255, 255, 255, 0.14);
	}
	.streak-title {
		margin: 0;
		font-family: var(--font-display);
		font-size: 12px;
		letter-spacing: 0.08em;
	}
	.streak-caption {
		margin: 1px 0 8px;
		font-family: var(--font-display);
		font-size: 8px;
		letter-spacing: 0.06em;
		opacity: 0.75;
	}
	.sea-dismiss:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}

	/* Corner minimap: parks in the top-right sky while the desktop view is zoomed.
	   Above the map canvas but below the control rail; non-interactive scenery. */
	.minimap-corner {
		position: absolute;
		top: 14px;
		right: 16px;
		z-index: 11;
		pointer-events: none;
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
		/* The dock carries the whole rail on phones — let it use the full width so
		   the scrubber spans edge to edge and the compact legend centres above it.
		   stretch makes the TimeDock child fill, so its scrubber can go full width. */
		.lane.dock {
			width: 100%;
			align-items: stretch;
		}
		.mobile-row {
			display: flex;
		}
		.mobile-top {
			display: flex;
		}
		.streaks-scene {
			display: block;
		}
	}
	@media (max-width: 640px) {
		.method-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
