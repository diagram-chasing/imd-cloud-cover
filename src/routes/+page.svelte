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
	import PixelBalloon from '$lib/components/PixelBalloon.svelte';
	import ChapterMark from '$lib/components/ChapterMark.svelte';
	import MeteogramAtlas from '$lib/components/MeteogramAtlas.svelte';
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
		'h-8 rounded-none border-2 border-ink bg-paper px-2.5 text-xs tracking-wider text-ink uppercase shadow-none hover:bg-cloud-block hover:text-ink';

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

	// Shoreline link under the map: scroll to the field notes article.
	function scrollToNotes() {
		click('open');
		const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		document
			.getElementById('field-notes')
			?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
	}

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
<!-- Thin paper mat so the frame border reads; the map goes as wide as the mat allows.
     On desktop the mat fills the first screen — short of 100svh so the shoreline and
     the article title peek above the fold (map height driven by it) and the page
     scrolls past to the content; on mobile the map keeps a tall min-height and the
     section grows in normal flow. -->
<section
	class="stage box-border bg-paper p-[clamp(8px,1.4vw,18px)] transition-[background-color] duration-[400ms] ease-[ease] md:h-[95svh]"
>
	<!-- Navy sky (bg-navy) behind the canvas while it loads. Definite height (not just
	     min-height) so the canvas fills the frame on mobile too — otherwise the solid
	     navy fallback shows behind the controls instead of the sea + gradient scrim the
	     way it does on desktop. Short of the full viewport so the shoreline and the
	     article's kicker peek above the fold — the cue that there's more to scroll to.
	     ::after is the edge scrim: an eased deep-sky wash under the control rail so the
	     white chrome keeps a contrast floor whatever the map draws beneath it. Tinted
	     with the scene's own navy (night-sky) it reads as sea depth, not a UI panel;
	     z just under the control bars (z-10). -->
	<div
		class="map-frame relative h-[max(88svh,440px)] overflow-hidden bg-navy after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:z-[9] after:h-[170px] after:bg-[linear-gradient(to_top,color-mix(in_srgb,var(--color-night-sky)_60%,transparent),color-mix(in_srgb,var(--color-night-sky)_42%,transparent)_35%,color-mix(in_srgb,var(--color-night-sky)_18%,transparent)_65%,transparent)] after:content-[''] md:h-full md:min-h-0"
	>
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
			<div class="loading grid h-full w-full place-items-center text-xs text-white">
				Reading the skies…
			</div>
		{/if}

		<!-- Desktop: while zoomed/panned, a corner minimap shows where the viewport sits
		     over India (and how far it's drifted into the sea). Phones use the pan-aside
		     streak reveal instead, so this is desktop-only. -->
		{#if core && zoomed && !isPhone}
			<!-- Above the map canvas but below the control rail; non-interactive scenery. -->
			<div
				class="minimap-corner pointer-events-none absolute top-3.5 right-4 z-[11]"
				transition:fade={{ duration: 160 }}
			>
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

		<!-- Desktop: station search parks in the top-left sky. -->
		{#if core}
			<div class="desktop-top absolute top-3.5 left-4 z-10 max-md:hidden">
				<StationSearch
					manifest={core.manifest}
					places={core.places}
					onselect={selectFromSearch}
					compact
					side="bottom"
					align="start"
				/>
			</div>
		{/if}

		<!-- Mobile chrome: corner chips in the sky strip left of the landmass
		     (the cartouche parks itself top-right on narrow viewports). -->
		<div class="mobile-top absolute top-0 left-0 z-10 hidden px-3 py-2.5 max-md:flex">
			<div class="chips flex gap-1.5">
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
				{/if}
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
				<BandToggle />
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
				<button
					class="sea-dismiss"
					aria-label="Close streaks"
					onclick={() => (sky.showStreaks = false)}
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

<!-- Shoreline: the seam between map and page reads as a coastline — pixel waves
     lapping either side of a quiet link down to the field notes. -->
<div class="shore">
	<span class="shore-waves" aria-hidden="true"></span>
	<button class="shore-link" onclick={scrollToNotes}>
		NOTES
		<svg class="shore-arrow" viewBox="0 0 7 7" width="11" height="11" aria-hidden="true">
			<path d="M3 0h1v4h-1z M1 4h5v1h-5z M2 5h3v1h-3z M3 6h1v1h-1z" fill="currentColor" />
		</svg>
	</button>
	<span class="shore-waves" aria-hidden="true"></span>
</div>

<!-- The field notes: the below-the-fold article. One centred prose measure, with
     the meteogram specimen and the pipeline diagram breaking out wide. -->
<div class="content" id="field-notes">
	<header class="article-head">
		<h1 class="headline">MAPPING CLOUDS WITH METEOGRAMS</h1>
		<p class="lede">
			Every morning the India Meteorological Department publishes a GFS <em>meteogram</em> for each of
			its ~1,200 observation stations.
		</p>
		<!-- <div class="byline">
			<a
				class="byline-plate"
				href="https://diagramchasing.fun"
				target="_blank"
				rel="noopener noreferrer"
			>
				<span class="byline-dot" aria-hidden="true"></span>
				DIAGRAM CHASING
			</a>
			<PixelBalloon size={24} />
		</div> -->
	</header>

	<section class="ch mt-8">
		<div class="prose">
			<p>
				A <strong>meteogram</strong> is a strip chart the India Meteorological Department publishes for
				each station — a 10-day forecast of cloud, rain, wind and temperature in eight stacked panels,
				dissected below.
			</p>
		</div>
		<div class="breakout">
			<MeteogramAtlas />
		</div>
	</section>

	<section class="ch mt-8">
		<div class="prose">
			<p>
				A daily
				<a
					class="m-link"
					href="https://github.com/diagram-chasing"
					target="_blank"
					rel="noopener noreferrer">GitHub Action</a
				>
				(11:00 IST) downloads every station's meteogram, pixel-extracts the cloud-cover panel, and keeps
				the day-0 slice — the first eight three-hourly steps. Those readings, split into high cirrus,
				mid alto and low cumulus bands, are aggregated into the static JSON views this site loads.
			</p>
		</div>
	</section>

	<section class="ch">
		<div class="prose">
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
		</div>
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
		   instead of the sea + gradient scrim the way it does on desktop. Short of
		   the full viewport so the shoreline and the article's kicker peek above
		   the fold — the cue that there's more to scroll to. */
		height: max(88svh, 440px);
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
		/* Short of 100svh so the shoreline strip and the top of the article title
		   peek above the fold. */
		.stage {
			height: 95svh;
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
		align-items: center;
		gap: 14px;
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

	/* Desktop station search: parks in the top-left sky. Hidden on phones, where the
	   corner chips carry search instead. */
	.desktop-top {
		position: absolute;
		top: 14px;
		left: 16px;
		z-index: 10;
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

	/* ————— Shoreline: pixel waves either side of a quiet scroll link. The wave
	   tile is the map's own 8×3 crest curve (buildWaveTex), inked for paper, and
	   the steps() animation flips it one pixel sideways like the sea's drift. */
	.shore {
		display: flex;
		align-items: center;
		gap: 18px;
		max-width: 1080px;
		margin: 0 auto;
		padding: 0 20px 0;
	}
	.shore-waves {
		flex: 1;
		height: 6px;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='3'%3E%3Cpath d='M1 0h2v1H1zM0 1h1v1H0zM3 1h1v1H3zM6 1h2v1H6zM4 2h2v1H4z' fill='%230b1d3a'/%3E%3C/svg%3E");
		background-repeat: repeat-x;
		background-size: 28px 6px;
		image-rendering: pixelated;
		opacity: 0.5;
		animation: shore-drift 2.4s steps(1) infinite;
	}
	@keyframes shore-drift {
		0%,
		100% {
			background-position-x: 0;
		}
		50% {
			background-position-x: 2px;
		}
	}
	.shore-link {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 6px 2px;
		font-family: var(--font-display);
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.1em;
		color: var(--ink);
		opacity: 0.75;
		cursor: pointer;
		transition:
			opacity 0.12s,
			color 0.12s;
	}
	.shore-link:hover {
		opacity: 1;
		color: var(--focus);
	}
	.shore-arrow {
		shape-rendering: crispEdges;
		animation: shore-dip 1.8s ease-in-out infinite;
	}
	@keyframes shore-dip {
		50% {
			transform: translateY(2px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.shore-waves,
		.shore-arrow {
			animation: none;
		}
	}

	/* ————— The field notes article. One centred 640px prose measure; the
	   specimen and pipeline break out to the full content width. */
	.content {
		max-width: 1080px;
		margin: 0 auto;
		padding: 56px 20px 60px;
		scroll-margin-top: 16px;
	}

	.article-head {
		text-align: center;
		max-width: 720px;
		margin: 0 auto;
	}
	.kicker {
		margin: 0 0 14px;
		font-family: var(--font-display);
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.14em;
		color: var(--muted-foreground);
	}
	.headline {
		margin: 0;
		font-family: var(--font-display);
		font-size: clamp(42px, 8vw, 76px);
		font-weight: 700;
		letter-spacing: 0.02em;
		line-height: 1.05;
		text-wrap: balance;
	}
	.lede {
		max-width: 560px;
		margin: 20px auto 0;
		font-size: clamp(17px, 2.2vw, 20px);
		line-height: 1.6;
		text-wrap: balance;
	}
	/* Byline as a station plate — the author labelled the way cities are on the
	   map: square dot, white plate, ink text. */
	.byline {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 12px;
		margin-top: 26px;
	}
	.byline-plate {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 5px 10px;
		background: #fff;
		box-shadow: 2px 2px 0 rgba(11, 29, 58, 0.3);
		font-family: var(--font-display);
		font-size: 13px;
		font-weight: 700;
		letter-spacing: 0.08em;
		color: var(--ink);
		text-decoration: none;
	}
	.byline-plate:hover {
		color: var(--focus);
	}
	.byline-dot {
		width: 6px;
		height: 6px;
		background: var(--ink);
	}
	.dateline {
		margin: 12px 0 0;
		font-family: var(--font-display);
		font-size: 11px;
		letter-spacing: 0.1em;
		color: var(--muted-foreground);
	}

	.prose {
		max-width: 640px;
		margin: 0 auto;
	}
	.prose p {
		font-size: 15px;
		line-height: 1.75;
		margin: 0 0 14px;
		color: var(--ink);
		text-wrap: pretty;
	}
	.breakout {
		margin-top: 32px;
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
		.desktop-top {
			display: none;
		}
		.streaks-scene {
			display: block;
		}
	}
</style>
