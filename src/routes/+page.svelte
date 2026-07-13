<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { browser } from '$app/environment';
	import type { Station, Rollup } from '$lib/types';
	import type { FeatureCollection } from 'geojson';
	import { loadDeferred, type CriticalData } from '$lib/api/load';
	import { topoToFeatures } from '$lib/map/geo';
	import { sky } from '$lib/state/sky.svelte';
	import { userGeo } from '$lib/state/geo.svelte';
	import { skyMode } from '$lib/theme';
	import { computeValues, rollupForView, resolveActiveDay } from '$lib/data';
	import { click } from '$lib/feedback';
	import { SITE_BASE } from '$lib/site';
	import SEO from '$lib/components/SEO.svelte';

	import type { HoverInfo } from '$lib/components/PixelMap.svelte';
	import MapShell from '$lib/components/MapShell.svelte';
	import TimeDock from '$lib/components/TimeDock.svelte';
	import BandToggle from '$lib/components/BandToggle.svelte';
	import StationTooltip from '$lib/components/StationTooltip.svelte';
	import StationSearch from '$lib/components/StationSearch.svelte';
	import StationDetails from '$lib/components/StationDetails.svelte';
	import Minimap from '$lib/components/Minimap.svelte';
	import SiteFooter from '$lib/components/SiteFooter.svelte';
	import PixelButton from '$lib/components/PixelButton.svelte';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { InformationCircleIcon, FocusIcon, ArrowDown01Icon } from '@hugeicons/core-free-icons';
	import FieldNotes from '$lib/content.md';

	let { data }: { data: CriticalData } = $props();

	let india = $derived(topoToFeatures(data.topo));
	let places = $state<FeatureCollection>();
	let rollup7 = $state<Rollup>();
	let rollup30 = $state<Rollup>();

	const pixelMapImport = browser ? import('$lib/components/PixelMap.svelte') : null;
	let PixelMap = $state<typeof import('$lib/components/PixelMap.svelte').default>();

	let mapPainted = $state(false);
	let error = $state<string | null>(null);

	let core = $derived({
		india,
		places,
		manifest: data.manifest,
		latest: data.latest,
		summary: data.summary,
		rollup7,
		rollup30
	});

	let tip = $state<HoverInfo | null>(null);

	let map = $state<{
		zoomIn: () => void;
		zoomOut: () => void;
		zoomReset: () => void;
	}>();
	let layout = $state({
		gutter: 0,
		zoomRatio: 1,
		view: { x: 0, y: 0, w: 0, h: 0 },
		world: { w: 1, h: 1 }
	});
	let isPhone = $state(false);
	$effect(() => {
		const mq = window.matchMedia('(max-width: 767px)');
		isPhone = mq.matches;
		const on = () => (isPhone = mq.matches);
		mq.addEventListener('change', on);
		return () => mq.removeEventListener('change', on);
	});
	// Scroll/pinch does the zooming; chrome appears only when there's a way back.
	let zoomed = $derived(layout.zoomRatio > 1.05);

	let deferredStarted = false;
	function ensureDeferred() {
		if (deferredStarted) return;
		deferredStarted = true;
		loadDeferred()
			.then((d) => {
				places = d.places;
				rollup7 = d.rollup7;
				rollup30 = d.rollup30;
			})
			.catch(() => {});
	}

	onMount(() => {
		userGeo.ensure(); // coarse visitor location for the "you are here" map marker
		pixelMapImport
			?.then((m) => (PixelMap = m.default))
			.catch((e) => (error = e instanceof Error ? e.message : 'Failed to load map'));
		const w = window as unknown as { requestIdleCallback?: (cb: () => void) => void };
		if (w.requestIdleCallback) w.requestIdleCallback(ensureDeferred);
		else setTimeout(ensureDeferred, 200);
	});

	$effect(() => {
		if (sky.view !== 'today') ensureDeferred();
	});

	let activeRollup = $derived(rollupForView(sky.view, core?.rollup7, core?.rollup30));

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

	let tipValues = $derived(tip ? (tip.agg ?? values[tip.code] ?? null) : null);

	let panelStation = $derived<Station | null>(
		sky.selectedCode && core ? (core.manifest.stations[sky.selectedCode] ?? null) : null
	);
	// desktop popover anchor point (click pos); null = search
	let anchorPoint = $state<{ x: number; y: number } | null>(null);
	function openStation(code: string, at?: { x: number; y: number }) {
		anchorPoint = at ?? null;
		sky.selectedCode = code;
	}
	function closePanel() {
		sky.selectedCode = null;
	}

	function selectFromSearch(code: string) {
		click('open');
		openStation(code);
	}

	let night = $derived(skyMode(sky.timeIndex) === 'night');

	function scrollToNotes() {
		click('open');
		const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		document
			.getElementById('field-notes')
			?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
	}

	// night: override paper/ink tokens on root to match navy canvas
	$effect(() => {
		document.documentElement.classList.toggle('night', night);
		return () => document.documentElement.classList.remove('night');
	});
</script>

<SEO
	seoTitle="Mapping India's Clouds — a daily pixel map of India's cloud cover"
	seoDescription="A daily pixel map of cloud cover over India, read from IMD meteograms."
	shareTitle="Mapping India's Clouds"
	canonicalUrl={SITE_BASE}
	shareImgPath="{SITE_BASE}/sharecard.jpg"
	shareImgAnimatedPath="{SITE_BASE}/sharecard.gif"
	shareImgAlt="A pixel map of cloud cover over India"
/>

<section
	class="stage box-border h-[98svh] bg-paper p-[clamp(8px,1.4vw,18px)] transition-[background-color] duration-[400ms] ease-[ease] md:h-[98svh]"
>
	<div
		class="map-frame relative h-[max(94svh,440px)] overflow-hidden bg-navy after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:z-[9] after:h-[170px] after:bg-[linear-gradient(to_top,color-mix(in_srgb,var(--color-night-sky)_60%,transparent),color-mix(in_srgb,var(--color-night-sky)_42%,transparent)_35%,color-mix(in_srgb,var(--color-night-sky)_18%,transparent)_65%,transparent)] after:content-[''] md:h-full md:min-h-0"
	>
		{#if browser && PixelMap}
			<PixelMap
				bind:this={map}
				india={core.india}
				places={core.places}
				manifest={core.manifest}
				{values}
				date={activeDate}
				onhover={(info) => (tip = info)}
				onselect={openStation}
				onlayout={(info) => {
					layout = info;
					mapPainted = true;
				}}
			/>
		{/if}
		{#if !mapPainted}
			<div class="pointer-events-none absolute inset-0 z-[1]" out:fade={{ duration: 320 }}>
				<MapShell {night} />
			</div>
		{/if}

		<div
			class="top-keys absolute top-0 right-0 z-[11] flex flex-col items-end gap-2 px-3 py-2.5 md:px-3.5 md:py-3"
		>
			<!-- fit key is a no-op when already framed but stays visible for discoverability -->
			<div class="chips flex items-start gap-1.5">
				<PixelButton
					size="sm"
					cap="paper"
					aria-label="Fit map"
					style="--pad: 4px 7px"
					onclick={() => map?.zoomReset()}
				>
					<HugeiconsIcon icon={FocusIcon} size={16} strokeWidth={2} />
				</PixelButton>

				{#if core}
					<StationSearch
						manifest={core.manifest}
						places={core.places}
						onselect={selectFromSearch}
						compact
						side="bottom"
						align="end"
					/>
				{/if}
				<PixelButton
					size="sm"
					href="#field-notes"
					aria-label="About this map"
					style="--pad: 4px 7px"
					onclick={() => click('open')}
				>
					<HugeiconsIcon icon={InformationCircleIcon} size={16} strokeWidth={2} />
				</PixelButton>
			</div>

			{#if core && zoomed && !isPhone}
				<div class="pointer-events-none" transition:fade={{ duration: 160 }}>
					<Minimap view={layout.view} world={layout.world} {night} />
				</div>
			{/if}
		</div>

		<div
			class="bar bottom pointer-events-none absolute inset-x-0 bottom-0 z-10 grid grid-cols-[1fr_auto_1fr] items-end gap-x-5 gap-y-3 px-4 py-3.5 **:pointer-events-auto max-md:grid-cols-1 max-md:justify-items-center md:max-lg:grid-cols-1 md:max-lg:justify-items-center md:max-lg:gap-2.5"
		>
			<!-- empty lane keeps grid dock optically centred -->
			<div class="lane legend max-md:hidden md:max-lg:hidden"></div>
			<div
				class="lane dock flex min-w-0 flex-col items-start gap-2 justify-self-center max-md:w-full max-md:items-stretch md:max-lg:order-first md:max-lg:justify-self-center"
			>
				<!-- phones: legend compresses to one row; fit key is in top-right -->
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
	</div>
</section>

<div
	class="shore mx-auto -mt-6 flex w-full max-w-[1080px] items-center gap-[18px] px-5 py-1.5 md:-mt-5"
>
	<span
		class="shore-waves h-[16px] flex-1 animate-shore-drift bg-size-[100px_16px] bg-repeat-x opacity-20 [image-rendering:pixelated] motion-reduce:animate-none"
		aria-hidden="true"
	></span>

	<PixelButton size="sm" aria-label="Scroll to the field notes" onclick={scrollToNotes}>
		<span class="flex items-center gap-2 text-xs font-bold tracking-widest uppercase">
			Field notes
			<HugeiconsIcon
				icon={ArrowDown01Icon}
				class="animate-shore-dip motion-reduce:animate-none"
				size={15}
				strokeWidth={2.5}
				aria-hidden="true"
			/>
		</span>
	</PixelButton>

	<span
		class="shore-waves h-[16px] flex-1 animate-shore-drift bg-size-[120px_16px] bg-repeat-x opacity-20 [image-rendering:pixelated] motion-reduce:animate-none"
		aria-hidden="true"
	></span>
</div>

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
		rollup={core.rollup30 ?? null}
		date={activeDate}
		when={whenLabel}
		at={anchorPoint}
		onclose={closePanel}
	/>
{/if}

<style>
	.shore-waves {
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='10'%3E%3Cpath d='M1 7h10v1H1z M2 5h1v2H2z M3 4h1v1H3z M16 6h10v1H16z M16 4h1v2H16z M17 2h1v2H17z M18 0h1v2H18z M31 7h10v1H31z M31 5h1v2H31z M32 3h1v2H32z M33 1h1v2H33z M34 5h1v2H34z M35 4h1v1H35z M45 6h10v1H45z M45 4h1v2H45z M46 2h1v2H46z M47 0h1v2H47z M48 4h1v2H48z M49 2h1v2H49z M50 0h1v2H50z' fill='%230b1d3a'/%3E%3C/svg%3E");
	}
</style>
