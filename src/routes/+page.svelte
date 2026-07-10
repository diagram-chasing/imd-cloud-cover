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

<section
	class="stage box-border bg-paper p-[clamp(8px,1.4vw,18px)] transition-[background-color] duration-[400ms] ease-[ease] md:h-[95svh]"
>
	<!-- Framed map: a full-width bordered panel on a thin paper mat. Definite height so
		the canvas fills the frame on mobile too, short of the full viewport so the
		shoreline and article title peek above the fold. bg-navy = sky behind the canvas
		while it loads. Edge scrim (::after) = eased deep-sky wash under the control rail,
		z-9 (just under the z-10 bars), so the white chrome keeps a contrast floor. -->
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
			over India. Above the map canvas, below the control rail; non-interactive. -->
		{#if core && zoomed && !isPhone}
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

		<!-- Desktop: station search parks in the top-left sky. Hidden on phones, where
			the corner chips carry search instead. -->
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

		<!-- Mobile chrome: corner chips in the sky strip. Hidden on desktop where the
			bottom rail carries everything. -->
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

		<!-- Bottom rail: WHAT (legend) · WHEN (timeline) · WHERE (find + fit). One rail,
			three lanes; grid keeps the dock optically centred. Tablets stack the lanes
			(dock first); phones drop legend/where and let the dock span full width. -->
		<div
			class="bar bottom pointer-events-none absolute inset-x-0 bottom-0 z-10 grid grid-cols-[1fr_auto_1fr] items-end gap-x-5 gap-y-3 px-4 py-3.5 **:pointer-events-auto max-md:grid-cols-1 max-md:justify-items-center md:max-lg:grid-cols-1 md:max-lg:justify-items-center md:max-lg:gap-2.5"
		>
			<div
				class="lane legend flex min-w-0 items-center gap-3.5 justify-self-start max-md:hidden md:max-lg:justify-self-center"
			>
				{#if zoomed}
					<!-- Quiet "way back": appears only while the view is actually zoomed. -->
					<button
						class="fit cursor-pointer px-1 py-0.5 text-xs tracking-[0.08em] text-white opacity-80 text-shadow-sky hover:opacity-100"
						onclick={() => map?.zoomReset()}>↺ FIT MAP</button
					>
				{/if}
				{#if core}
					<!-- Quiet text toggle voiced like ViewTabs: recedes at rest, brightens on
						hover, underlines when the streaks are shown. -->
					<button
						class={[
							'streaks-toggle cursor-pointer p-0 text-xs tracking-[0.08em] text-white text-shadow-sky',
							sky.showStreaks
								? 'underline decoration-2 underline-offset-[3px] opacity-100'
								: 'opacity-55 hover:opacity-90'
						]}
						aria-pressed={sky.showStreaks}
						onclick={toggleStreaks}>STREAKS</button
					>
				{/if}
			</div>
			<div
				class="lane dock flex min-w-0 flex-col items-start gap-2 justify-self-center max-md:w-full max-md:items-stretch md:max-lg:order-first md:max-lg:justify-self-center"
			>
				<!-- Phones only: legend compresses to one glyph row above the timeline, with
					the fit-map icon tucked right without shifting the centred glyphs. -->
				<div class="mobile-row relative hidden items-center justify-center gap-3 max-md:flex">
					<BandToggle horizontal />
					{#if zoomed}
						<button
							class="fit fit-icon absolute right-0 cursor-pointer px-1 text-base leading-none text-white opacity-80 text-shadow-sky hover:opacity-100"
							aria-label="Fit map"
							onclick={() => map?.zoomReset()}>↺</button
						>
					{/if}
				</div>
				<TimeDock dates={activeRollup?.dates ?? null} />
			</div>
			<div
				class="lane where flex min-w-0 items-center gap-3 justify-self-end max-md:hidden md:max-lg:justify-self-center"
			>
				<BandToggle />
			</div>
		</div>

		{#if error}<p class="error absolute top-[60px] left-4 z-[11] text-xs text-error-tint">
				Couldn’t load today’s sky: {error}
			</p>{/if}

		<p class="sr-only">
			Interactive pixel map of cloud cover over India.
			{#if core}{core.summary.station_count} stations; use the station search to explore.{/if}
		</p>

		<!-- Streak leaderboard: collapsed tab / inset table in the right sea gutter.
			Phone streaks: a scene bounded to the map area. The board is pinned to a
			world anchor in the open sea and slides in with the camera pan; same white
			sky-typography as the desktop gutter list. No scrim/panel — it reads as part
			of the world. --ink flips the board text white. -->
		{#if core && sky.showStreaks}
			<div
				class="streaks-scene absolute inset-0 z-20 hidden text-white [--ink:var(--color-ink-on-dark)] max-md:block"
				role="dialog"
				aria-modal="true"
				aria-label="Station streaks"
				tabindex="-1"
				transition:fade={{ duration: 160 }}
				onkeydown={(e) => {
					if (e.key === 'Escape') sky.showStreaks = false;
				}}
			>
				<!-- Transparent catch-all: tap the open sea to dismiss. -->
				<button
					class="sea-dismiss absolute inset-0 cursor-pointer border-0 bg-transparent"
					aria-label="Close streaks"
					onclick={() => (sky.showStreaks = false)}
				></button>

				<!-- Board seats just above the control rail; the map pans so the land sits a
					pad above it (bottom must match CONTROLS_RESERVE in the script). -->
				<div
					class="streak-dock pointer-events-none absolute inset-x-0 bottom-[140px] flex justify-center px-3.5"
				>
					<div
						class="streak-world pointer-events-none w-[min(88vw,340px)] text-shadow-sky"
						bind:clientHeight={boardH}
					>
						<h2 class="streak-title m-0 text-xs tracking-[0.08em]">STATION STREAKS</h2>
						<p class="streak-caption mx-0 mt-px mb-2 text-xs tracking-[0.06em] opacity-75">
							CONSECUTIVE CLEAR / OVERCAST DAYS
						</p>
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

<!-- Shoreline: pixel waves either side of a quiet scroll link. The wave tile is the
	map's own 8×3 crest curve (buildWaveTex), inked for paper; the steps() animation
	flips it one pixel sideways like the sea's drift. -->
<div class="shore mx-auto flex max-w-[1080px] items-center gap-[18px] px-5">
	<span
		class="shore-waves h-[6px] flex-1 animate-shore-drift bg-size-[28px_6px] bg-repeat-x opacity-50 [image-rendering:pixelated] motion-reduce:animate-none"
		aria-hidden="true"
	></span>
	<button
		class="shore-link inline-flex cursor-pointer items-center gap-2 px-0.5 py-1.5 text-xs font-bold tracking-widest text-ink opacity-75 transition-[opacity,color] duration-120 hover:text-focus hover:opacity-100"
		onclick={scrollToNotes}
	>
		NOTES
		<svg
			class="shore-arrow animate-shore-dip [shape-rendering:crispEdges] motion-reduce:animate-none"
			viewBox="0 0 7 7"
			width="11"
			height="11"
			aria-hidden="true"
		>
			<path d="M3 0h1v4h-1z M1 4h5v1h-5z M2 5h3v1h-3z M3 6h1v1h-1z" fill="currentColor" />
		</svg>
	</button>
	<span
		class="shore-waves h-[6px] flex-1 animate-shore-drift bg-size-[28px_6px] bg-repeat-x opacity-50 [image-rendering:pixelated] motion-reduce:animate-none"
		aria-hidden="true"
	></span>
</div>

<!-- The field notes article. One centred 640px prose measure; the specimen and
	pipeline break out to the full content width. -->
<div class="content mx-auto max-w-[1080px] scroll-mt-4 px-5 pt-14 pb-[60px]" id="field-notes">
	<header class="article-head mx-auto max-w-[720px] text-center">
		<h1
			class="headline m-0 text-5xl leading-none font-bold tracking-[0.02em] text-balance md:text-7xl"
		>
			MAPPING CLOUDS WITH METEOGRAMS
		</h1>
		<p class="lede mx-auto mt-5 max-w-[560px] text-lg leading-relaxed text-balance md:text-xl">
			Every morning the India Meteorological Department publishes a GFS <em>meteogram</em> for each of
			its ~1,200 observation stations.
		</p>
	</header>

	<section class="ch mt-8">
		<!-- Prose measure: 640px centred column; paragraphs inherit the ink body. -->
		<div
			class="prose mx-auto max-w-[640px] [&_p]:mx-0 [&_p]:mt-0 [&_p]:mb-3.5 [&_p]:text-base [&_p]:leading-relaxed [&_p]:text-pretty [&_p]:text-ink"
		>
			<p>
				The Indian Meteorological Department (IMD) publishes a dense, complex data product called a <strong
					>meteogram</strong
				>. While it can be overwhelming at first glance, it packs a massive amount of information
				into a single image, which makes it a very useful tool for forecasters, power grid
				operators, and anyone tracking the weather.
			</p>
			<p>
				A meteogram is a visual 10-day forecast broken down into three-hour intervals, stacked with
				vertical panels that track variables like temperature, humidity, and atmospheric pressure.
				With hundreds of on-ground weather stations scattered across India generating these
				graphics, the IMD can map out the weather at a granular level nationwide.
			</p>
		</div>
		<div class="breakout mt-8">
			<MeteogramAtlas />
		</div>
	</section>

	<section class="ch mt-8">
		<div
			class="prose mx-auto max-w-[640px] [&_p]:mx-0 [&_p]:mt-0 [&_p]:mb-3.5 [&_p]:text-base [&_p]:leading-relaxed [&_p]:text-pretty [&_p]:text-ink"
		>
			<p>
				But what really caught my eye was how these graphics represent cloud cover. Look closely,
				and you’ll realize it’s actually drawn to look like a literal cloudy sky!
			</p>
			<p>
				The cloud coverage panel is essentially a stacked histogram divided into three distinct
				atmospheric tiers: low clouds (surface to 2 km), medium clouds (2 to 7 km), and high clouds
				(above 7 km). If a specific block of time is fully white, it means the station expects
				roughly 100% cloud coverage at that altitude. Since low clouds, like cumulus, are the ones
				that bring rain, a dense white block in the bottom tier usually correlates perfectly with a
				spike in the precipitation bar right above it.
			</p>
			<p>
				I love this visualization. The fact that some developer, years ago, decided to map
				meteorological data in such a cute, pixel-art style feels like something straight out of
				Super Mario or Flappy Bird.
			</p>
			<p>
				It appealed to me so much that a few months ago, I started archiving these every day. I
				wrote a script to analyse the pixels, turning the histogram images back into structured data
				so I could plot the current slice of time on a map. We now run this collection and analysis
				daily, gathering the data to map out India's 8-bit skies right at the top of this page.
			</p>
		</div>
	</section>

	<section class="ch">
		<div
			class="prose mx-auto max-w-[640px] [&_p]:mx-0 [&_p]:mt-0 [&_p]:mb-3.5 [&_p]:text-base [&_p]:leading-relaxed [&_p]:text-pretty [&_p]:text-ink"
		>
			<p>
				The site is built with
				<a
					class="m-link text-ink underline underline-offset-[3px] transition-colors duration-120 hover:text-focus"
					href="https://svelte.dev/docs/kit/introduction"
					target="_blank"
					rel="noopener noreferrer">SvelteKit</a
				>
				and Svelte 5 runes. The map is projected with
				<a
					class="m-link text-ink underline underline-offset-[3px] transition-colors duration-120 hover:text-focus"
					href="https://d3js.org/d3-geo"
					target="_blank"
					rel="noopener noreferrer">D3</a
				>
				and rendered as an interactive pixel field with
				<a
					class="m-link text-ink underline underline-offset-[3px] transition-colors duration-120 hover:text-focus"
					href="https://pixijs.com"
					target="_blank"
					rel="noopener noreferrer">PixiJS</a
				>: each station becomes a three-mark cloud tower, and the grid subdivides toward individual
				stations as you zoom in. The full pipeline and source are open on
				<a
					class="m-link text-ink underline underline-offset-[3px] transition-colors duration-120 hover:text-focus"
					href="https://github.com/diagram-chasing"
					target="_blank"
					rel="noopener noreferrer">GitHub</a
				>.
			</p>
		</div>
	</section>

	<section class="support-band mt-16">
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
	/* Shoreline wave tile: the map's own 8×3 crest curve (buildWaveTex) inked for
	   paper. Kept here because the data-URL carries internal single quotes AND
	   spaces, so it can't survive a Tailwind bg-[url(...)] arbitrary value; the
	   %230b1d3a in the fill is the image ink, not a CSS color token. */
	.shore-waves {
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='3'%3E%3Cpath d='M1 0h2v1H1zM0 1h1v1H0zM3 1h1v1H3zM6 1h2v1H6zM4 2h2v1H4z' fill='%230b1d3a'/%3E%3C/svg%3E");
	}
	/* StreakBoard internals bridge: the leaderboard rows are a child component's
	   <li><button>; reach in to add the sky text-shadow and a hover wash. */
	.streak-world :global(li button) {
		pointer-events: auto;
		text-shadow: 1px 1px 0 --alpha(var(--color-navy) / 90%);
	}
	.streak-world :global(li button:hover) {
		background: --alpha(white / 14%);
	}
</style>
