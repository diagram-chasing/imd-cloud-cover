<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import type { Station } from '$lib/types';
	import { loadCore, type CoreData } from '$lib/api/load';
	import { CORE_BASE } from '$lib/api/r2';
	import { sky } from '$lib/state/sky.svelte';
	import { skyMode } from '$lib/theme';
	import { computeValues, rollupForView, resolveActiveDay } from '$lib/data';
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
	import SiteFooter from '$lib/components/SiteFooter.svelte';
	import PixelButton from '$lib/components/PixelButton.svelte';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import FieldNotes from '$lib/content.md';

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

	onMount(async () => {
		try {
			core = await loadCore();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load data';
		}
	});

	let activeRollup = $derived(rollupForView(sky.view, core?.rollup7, core?.rollup30));
	// In today view, which forecast day matches the visitor's current IST date.
	// This lets the map read as "today" even before today's scrape has landed.
	let activeDay = $derived(core ? resolveActiveDay(core.latest) : null);
	let values = $derived(
		computeValues(
			sky.view,
			core?.latest,
			activeRollup,
			sky.timeIndex,
			sky.windowDayIndex,
			activeDay?.index ?? 0
		)
	);

	// The single "when am I looking at" answer, derived from the scrub state so the
	// cartouche, tooltip and station card all agree. In today view the date is fixed
	// and the time steps; in week/month the date is the scrubbed window day and the
	// reading is a daily mean.
	const HOUR_LABELS = ['00', '03', '06', '09', '12', '15', '18', '21'];
	let activeDate = $derived.by(() => {
		if (!core) return '';
		if (sky.view === 'today') return activeDay?.date ?? core.summary.date;
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

		<!-- While zoomed/panned: the way back lives in the top-right corner on every
			layout — an icon-only pixel key, stacked under the desktop minimap (which
			shows where the viewport sits over India; non-interactive). -->
		{#if core && zoomed}
			<div
				class="minimap-corner absolute top-3.5 right-4 z-[11] flex flex-col items-end gap-2 max-md:top-2.5 max-md:right-3"
				transition:fade={{ duration: 160 }}
			>
				{#if !isPhone}
					<div class="pointer-events-none">
						<Minimap view={layout.view} world={layout.world} {night} />
					</div>
				{/if}
				<PixelButton
					size="sm"
					cap="paper"
					aria-label="Fit map"
					style="--pad: 5px 6px"
					onclick={() => map?.zoomReset()}
				>
					<!-- Pixel "fit" glyph: four corner brackets. -->
					<svg
						class="block [shape-rendering:crispEdges]"
						viewBox="0 0 8 8"
						width="16"
						height="16"
						aria-hidden="true"
					>
						<path
							d="M0 0h3v1H1v2H0z M5 0h3v3H7V1H5z M0 5h1v2h2v1H0z M7 5h1v3H5V7h2z"
							fill="currentColor"
						/>
					</svg>
				</PixelButton>
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

		<!-- Corner keys in the top-left sky, every layout: streaks toggle + search. -->
		<div class="top-keys absolute top-0 left-0 z-10 flex px-3 py-2.5 md:px-3.5 md:py-3">
			<div class="chips flex items-start gap-1.5">
				{#if core}
					<!-- Toggle voiced as hardware: the key sits sunk + gold while streaks show. -->
					<PixelButton
						size="sm"
						cap={sky.showStreaks ? 'gold' : 'paper'}
						class="text-xs tracking-wider uppercase"
						aria-pressed={sky.showStreaks}
						onclick={toggleStreaks}>Streaks</PixelButton
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
			<!-- Empty first lane: streaks + search moved to the top-left corner keys;
				kept so the grid keeps the dock optically centred. -->
			<div class="lane legend max-md:hidden md:max-lg:hidden"></div>
			<div
				class="lane dock flex min-w-0 flex-col items-start gap-2 justify-self-center max-md:w-full max-md:items-stretch md:max-lg:order-first md:max-lg:justify-self-center"
			>
				<!-- Phones only: legend compresses to one key row above the timeline; the
					fit-map key lives in the top-right corner with the minimap stack. -->
				<div class="mobile-row relative hidden items-center justify-center gap-3 max-md:flex">
					<BandToggle horizontal />
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

<!-- Shoreline: pixel wind barbs either side of a quiet scroll link. The tile is a
	staggered station-plot barb series (half barb → two full barbs) on wandering
	baselines; the steps() animation nudges it sideways like a passing breeze. -->
<div class="shore mx-auto flex max-w-[1080px] items-center gap-[18px] px-5">
	<span
		class="shore-waves h-[16px] flex-1 animate-shore-drift bg-size-[120px_16px] bg-repeat-x opacity-50 [image-rendering:pixelated] motion-reduce:animate-none"
		aria-hidden="true"
	></span>
	<button
		class="shore-link inline-flex cursor-pointer items-center gap-2 px-0.5 py-1.5 text-xs font-bold tracking-widest text-ink opacity-75 transition-[opacity,color] duration-120 hover:text-focus hover:opacity-100"
		onclick={scrollToNotes}
	>
		<!-- NOTES -->
		<ArrowDown
			class="shore-arrow animate-shore-dip motion-reduce:animate-none"
			size={20}
			strokeWidth={2.5}
			aria-hidden="true"
		/>
	</button>
	<span
		class="shore-waves h-[16px] flex-1 animate-shore-drift bg-size-[120px_16px] bg-repeat-x opacity-50 [image-rendering:pixelated] motion-reduce:animate-none"
		aria-hidden="true"
	></span>
</div>

<!-- The field notes article: mdsvex copy from $lib/content.md, set by
	the Gutenberg-style baseline grid in typography.css (.article). In-content
	components (the specimen atlas, the city explorer, the support band) are
	imported inside the markdown itself; the explorer needs the core data. -->
<article class="article scroll-mt-4" id="field-notes">
	<FieldNotes manifest={core?.manifest} places={core?.places} india={core?.india} />
</article>

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
	/* Shoreline wind-barb tile: a 60×8 station-plot barb series — half barb, full
	   barb, barb-and-a-half, two barbs — with feathers stepping up-right and the
	   baselines alternating a pixel so the repeat reads organic. Kept here because
	   the data-URL carries internal single quotes AND spaces, so it can't survive
	   a Tailwind bg-[url(...)] arbitrary value; the %230b1d3a in the fill is the
	   image ink, not a CSS color token. */
	.shore-waves {
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='8'%3E%3Cpath d='M1 7h10v1H1z M2 5h1v2H2z M3 4h1v1H3z M16 6h10v1H16z M16 4h1v2H16z M17 2h1v2H17z M18 0h1v2H18z M31 7h10v1H31z M31 5h1v2H31z M32 3h1v2H32z M33 1h1v2H33z M34 5h1v2H34z M35 4h1v1H35z M45 6h10v1H45z M45 4h1v2H45z M46 2h1v2H46z M47 0h1v2H47z M48 4h1v2H48z M49 2h1v2H49z M50 0h1v2H50z' fill='%230b1d3a'/%3E%3C/svg%3E");
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
