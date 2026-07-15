<script lang="ts">
	import { base } from '$app/paths';
	import type { FeatureCollection } from 'geojson';
	import type { Forecast, Station } from '$lib/types';
	import { meteogramImageUrl } from '$lib/api/r2';
	import { webcamFor } from '$lib/webcams';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { CctvCameraIcon, ArrowUpRight01Icon } from '@hugeicons/core-free-icons';
	import CityToday from '$lib/components/city/CityToday.svelte';
	import CityMap from '$lib/components/city/CityMap.svelte';
	import CloudGlyph from '$lib/components/city/CloudGlyph.svelte';
	import StationMeteogram from '$lib/components/StationMeteogram.svelte';
	import StationTooltip from '$lib/components/StationTooltip.svelte';
	import SkyBarcode from '$lib/components/city/SkyBarcode.svelte';
	import PixelButton from '$lib/components/PixelButton.svelte';
	import PlaceTimeControls from '$lib/components/place/PlaceTimeControls.svelte';
	import Wordmark from '$lib/components/Wordmark.svelte';

	type Cover = { h: number; m: number; l: number; p?: number };
	interface NearbyStation {
		code: string;
		name: string;
		lat: number;
		lon: number;
		km: number;
		primary?: boolean;
	}

	interface Props {
		mode: 'city' | 'station';
		/** Masthead. */
		name: string;
		dateline: string;
		/** Reading card. */
		values: Cover | null;
		stationName: string;
		km?: number | null;
		date: string;
		when: string;
		/** Forecast strip + meteogram image (keyed by the reading station's code + date). */
		forecast: Forecast | null;
		metDate: string;
		metCode: string;
		metCaption?: string;
		/** City mode only. */
		perStation?: Record<string, Cover>;
		india?: FeatureCollection;
		stations?: NearbyStation[];
		/** Adjoining cities labelled on the map (station mode). */
		cities?: { name: string; lat: number; lon: number }[];
		stationLookup?: Record<string, Station>;
		/** This place's day-by-day cover over the archived window, for the barcode
		 * strip. Omitted until the record loads. */
		history?: {
			dates: string[];
			name: string;
			e: (number | null)[];
		} | null;
		/** Day/hour scrubber. Rendered only when `onTime` is supplied; the reading,
		 * per-station map and forecast marker all follow the chosen (dayIndex, timeIndex). */
		days?: string[];
		dayIndex?: number;
		timeIndex?: number;
		isLive?: boolean;
		liveDay?: number;
		liveTime?: number;
		onTime?: (dayIndex: number, timeIndex: number) => void;
		onNow?: () => void;
	}

	let {
		mode,
		name,
		dateline,
		values,
		stationName,
		km = null,
		date,
		when,
		forecast,
		metDate,
		metCode,
		metCaption,
		perStation = {},
		india,
		stations = [],
		cities = [],
		stationLookup = {},
		history = null,
		days,
		dayIndex = 0,
		timeIndex = 0,
		isLive = true,
		liveDay = 0,
		liveTime = 0,
		onTime,
		onNow
	}: Props = $props();

	let tip = $state<{ code: string; clientX: number; clientY: number } | null>(null);
	let tipStation = $derived<Station | null>(tip ? (stationLookup[tip.code] ?? null) : null);
	let tipValues = $derived(tip ? (perStation[tip.code] ?? null) : null);

	function href(s: NearbyStation): string | null {
		return s.primary ? null : `${base}/station/${s.code}`;
	}

	let webcam = $derived(webcamFor(metCode));
</script>

<main class="mx-auto max-w-[860px] px-5 pt-6 pb-18">
	<div class="my-8">
		<PixelButton size="sm" href="{base}/">BACK TO MAP</PixelButton>
	</div>

	<article class="flex flex-col gap-6">
		<header class="border-b-2 border-ink pb-3">
			<h1 class=" text-[length:clamp(2rem,7vw,calc(var(--ms-6)*1rem))] leading-[1.05] uppercase">
				{name}{#if mode === 'station'}<span class="ml-3 inline-block text-sm font-bold text-ink"
						>[WEATHER STATION]</span
					>{/if}
			</h1>
			<p class="mt-1.5 text-base">{dateline}</p>
		</header>

		<!-- Reading + regional locator: same two-column layout in both modes. -->
		<section
			class="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]"
		>
			<CityToday expanded {values} {stationName} {km} {date} {when}>
				{#snippet footer()}
					{#if onTime && days && days.length}
						<PlaceTimeControls
							{days}
							{dayIndex}
							{timeIndex}
							{isLive}
							{liveDay}
							{liveTime}
							onchange={onTime}
							onnow={onNow ?? (() => {})}
						/>
					{/if}
				{/snippet}
			</CityToday>
			<div class="h-full min-w-0">
				{#if india && stations.length}
					<CityMap
						{india}
						city={null}
						{stations}
						values={perStation}
						places={mode === 'city' ? [] : cities}
						minSpanFactor={mode === 'city' ? 0.02 : 0.12}
						onhover={(info) => (tip = info)}
					/>
				{:else}
					<div class="aspect-[1.5] w-full bg-day-sea shadow-[0_0_0_1px] shadow-ink/40"></div>
				{/if}
			</div>
		</section>

		{#if webcam}
			<a
				class="group flex items-center gap-3 bg-paper px-4 py-3 text-ink no-underline shadow-[0_0_0_2px] shadow-ink transition-colors hover:bg-focus"
				href={webcam.url}
				target="_blank"
				rel="noopener noreferrer"
			>
				<HugeiconsIcon icon={CctvCameraIcon} size={20} strokeWidth={2} aria-hidden="true" />
				<span class="flex-1 text-sm tracking-[0.03em] uppercase">
					Live webcam <span class="opacity-55">· {webcam.source}</span>
				</span>
				<HugeiconsIcon icon={ArrowUpRight01Icon} size={16} strokeWidth={2.5} aria-hidden="true" />
			</a>
		{/if}

		<section>
			<h2 class="mb-3 border-b border-ink pb-1 text-xl">CLOUD COVER FORECAST</h2>
			<StationMeteogram {forecast} today={date} />
			<p class="mt-2 text-sm">{metCaption ?? 'NEXT 10 DAYS · 3-HOURLY'}</p>
		</section>
		{#if history}
			<section>
				<h2 class=" mb-3 border-b border-ink pb-1 text-xl">HISTORY</h2>

				<SkyBarcode dates={history.dates} aName={history.name} aE={history.e} axis />
			</section>
		{/if}
		<section>
			<h2 class="mb-3 border-b border-ink pb-1 text-xl">METEOGRAM</h2>
			<div class="bg-paper leading-[0] shadow-[0_0_0_2px] shadow-ink">
				<img
					class="block h-auto w-full"
					src={meteogramImageUrl(metDate, metCode)}
					alt="Original IMD meteogram for {stationName}"
					loading="lazy"
				/>
			</div>
			<p class="mt-2 text-xs opacity-60">SOURCE: IMD</p>
		</section>
	</article>

	{#if mode === 'city' && stations.length}
		<section>
			<h2 class="mt-6 mb-3 border-b border-ink pb-1 text-xl">NEARBY STATIONS</h2>
			<ul class="grid grid-cols-2 gap-x-10 sm:grid-cols-3">
				{#each stations as s (s.code)}
					{@const link = href(s)}
					<li>
						<svelte:element
							this={link ? 'a' : 'div'}
							href={link ?? undefined}
							class={[
								'group flex items-center gap-2.5 py-0.5 no-underline',
								link && 'cursor-pointer'
							]}
						>
							<span
								class="grid h-9 w-10 shrink-0 place-items-center overflow-hidden bg-day-sea shadow-[0_0_0_1px] shadow-ink/40"
							>
								<CloudGlyph code={s.code} values={perStation[s.code]} cell={4} />
							</span>
							<span
								class={[
									'min-w-0 flex-1 truncate text-xs tracking-wide',
									s.primary ? '-ml-1 bg-focus pl-1 font-bold text-black' : 'group-hover:text-focus'
								]}>{s.name.toUpperCase()}</span
							>
							<span class="shrink-0 text-xs tabular-nums opacity-45">{s.km} KM</span>
						</svelte:element>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<footer
		class="mt-[calc(var(--leading)*2)] flex flex-wrap items-center justify-between gap-4 border-t-2 border-ink pt-4"
	>
		<Wordmark />
		<p class="text-base font-bold uppercase">Mapping India's Clouds</p>
	</footer>
</main>

{#if tip && tipStation}
	<StationTooltip
		station={tipStation}
		values={tipValues}
		clientX={tip.clientX}
		clientY={tip.clientY}
		{date}
		{when}
	/>
{/if}
