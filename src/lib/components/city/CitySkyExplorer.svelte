<script lang="ts">
	import type { StationsManifest, CitiesRollup } from '$lib/types';
	import type { FeatureCollection } from 'geojson';
	import { fetchCities } from '$lib/api/r2';
	import { ordinal } from '$lib/format';
	import { click } from '$lib/feedback';
	import StationSearch from '$lib/components/StationSearch.svelte';
	import { TabSwitch } from '$lib/components/ui/switch';
	import CloudHistogram from './CloudHistogram.svelte';
	import SkyTwin from './SkyTwin.svelte';

	interface Props {
		manifest: StationsManifest;
		places?: FeatureCollection;
		india: FeatureCollection;
	}
	let { manifest, places, india }: Props = $props();

	// One remembered choice: returning visitors land straight on their city.
	const STORE_KEY = 'csx:city';

	let data = $state<CitiesRollup | null>(null);
	let failed = $state(false);
	let selected = $state<string | null>(null);
	let mode = $state<'today' | 'overall'>('overall');
	let root = $state<HTMLElement>();

	// The rollup lives below a long article — fetch it once, when scrolled near.
	$effect(() => {
		if (!root || data || failed) return;
		const io = new IntersectionObserver(
			(entries) => {
				if (!entries.some((e) => e.isIntersecting)) return;
				io.disconnect();
				fetchCities()
					.then((d) => (data = d))
					.catch(() => (failed = true));
			},
			{ rootMargin: '600px' }
		);
		io.observe(root);
		return () => io.disconnect();
	});

	// Default city: the remembered pick if it still exists, else the biggest city.
	$effect(() => {
		if (!data || selected) return;
		const stored = localStorage.getItem(STORE_KEY);
		if (stored && data.cities[stored]) {
			selected = stored;
			return;
		}
		let best: string | null = null;
		for (const [code, c] of Object.entries(data.cities)) {
			if (!best || (c.pop ?? 0) > (data.cities[best].pop ?? 0)) best = code;
		}
		selected = best;
	});

	function select(code: string) {
		click('open');
		selected = code;
		localStorage.setItem(STORE_KEY, code);
	}

	let city = $derived(selected && data ? (data.cities[selected] ?? null) : null);
	// The arc points at the twin that matches the active mode: today's closest sky
	// vs the long-term climate match.
	let activeTwin = $derived(
		city ? (mode === 'today' ? (city.twin?.today ?? null) : (city.twin?.alltime ?? null)) : null
	);
	let total = $derived(data ? Object.keys(data.cities).length : 0);
	let cityCodes = $derived(data ? new Set(Object.keys(data.cities)) : undefined);
</script>

<section
	bind:this={root}
	id="city-explorer"
	class="scroll-mt-4 pt-16"
	aria-label="City sky explorer"
>
	{#if failed}
		<p class="px-5 text-center text-xs tracking-wider text-error-tint uppercase">
			Couldn't load the city record — try again later.
		</p>
	{:else if !data || !city || !selected}
		<div
			class="grid min-h-[560px] place-items-center bg-day-sea text-xs tracking-[0.1em] text-white uppercase"
		>
			Gathering the clouds…
		</div>
	{:else}
		<header
			class="mx-auto mb-7 grid max-w-2xl items-center gap-x-8 gap-y-6 px-5 md:grid-cols-[minmax(0,1fr)_auto]"
		>
			<div class="flex min-h-[110px] flex-col items-start justify-start text-center md:text-left">
				<h2 class="m-0 font-bold" style="font-size: clamp(24px, 3.6vw, 38px); line-height: 1.3;">
					How cloudy <br /> has it been in
					<StationSearch
						{manifest}
						{places}
						codes={cityCodes}
						cityFirst
						side="bottom"
						align="start"
						onselect={select}
					>
						{#snippet trigger(props)}
							<button
								{...props}
								class="block cursor-pointer border-b-4 border-sun-gold p-0 px-1 align-baseline font-bold whitespace-nowrap text-ink uppercase transition-colors duration-120 hover:text-focus"
							>
								{city.name}
								<!-- Pixel caret: this word is a key, press it. -->
								<svg
									class="ml-0.5 inline-block [shape-rendering:crispEdges]"
									viewBox="0 0 7 4"
									width="13"
									height="8"
									aria-hidden="true"
								>
									<path d="M0 0h7v1H6v1H5v1H4v1H3V3H2V2H1V1H0z" fill="currentColor" />
								</svg>
							</button>
						{/snippet}
					</StationSearch>
				</h2>

				<!-- Today vs the long record: reshuffles the sky, clouds gliding to
					their new columns. -->
				<div class="mt-5 flex justify-center md:justify-start">
					<TabSwitch
						options={[
							{ value: 'overall', label: 'Overall' },
							{ value: 'today', label: 'Today' }
						]}
						bind:value={mode}
					/>
				</div>
				<p class="m-0 mt-6 text-xs tracking-[0.08em] uppercase opacity-70">
					{ordinal(city.rank)} cloudiest of {total} cities
					<span class="opacity-60">·</span>
					<a
						href={`/station/${selected}`}
						class="font-bold text-ink underline decoration-ink/40 underline-offset-4 transition-colors duration-120 hover:text-focus"
					>
						Station page →
					</a>
				</p>
			</div>

			<!-- Sky panel: day-sea blue matches the histogram's own fill, so the map
				reads as a window into the same sky. Hard pixel drop, desktop only. -->
			<div class="hidden self-end md:block">
				<div class="bg-day-sea px-4 pt-4 pb-3 shadow-[4px_4px_0_rgba(11,29,58,0.35)]">
					<SkyTwin {city} code={selected} {mode} {data} {india} stations={manifest.stations} />
				</div>
			</div>
		</header>

		<!-- The sky: full-bleed histogram canvas, unobstructed. The twin lead is
			drawn inside it, a dotted arc between the two clouds. -->
		<CloudHistogram {data} {selected} {mode} twin={activeTwin} onselect={select} />
	{/if}
</section>
