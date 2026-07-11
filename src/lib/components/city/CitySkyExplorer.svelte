<script lang="ts">
	import type { StationsManifest, CitiesRollup } from '$lib/types';
	import type { FeatureCollection } from 'geojson';
	import { fetchCities } from '$lib/api/r2';
	import { ordinal } from '$lib/format';
	import { citySlugs } from '$lib/city/slug.js';
	import { haversineKm } from '$lib/city/distance';
	import { userGeo } from '$lib/state/geo.svelte';
	import { base as APP_BASE } from '$app/paths';
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

	const STORE_KEY = 'csx:city';

	// Max distance (km) from the visitor to their nearest city for us to default to
	// it — beyond this (e.g. an overseas visitor) we fall back to the biggest city.
	const NEAR_KM = 250;

	let data = $state<CitiesRollup | null>(null);
	let failed = $state(false);
	let selected = $state<string | null>(null);
	// True once a stored/clicked choice pins the selection; blocks the geo default
	// from overriding a deliberate pick (but a tentative pop-default stays open so
	// a late-arriving location can still win).
	let pinned = $state(false);
	let mode = $state<'today' | 'overall'>('overall');
	let root = $state<HTMLElement>();

	// Kick off the coarse (IP) location fetch as soon as the explorer mounts.
	$effect(() => {
		userGeo.ensure();
	});

	function nearestCity(lat: number, lng: number): string | null {
		if (!data) return null;
		let best: string | null = null;
		let bestKm = Infinity;
		for (const code of Object.keys(data.cities)) {
			const st = manifest.stations[code];
			if (!st) continue;
			const km = haversineKm(lat, lng, st.lat, st.lon);
			if (km < bestKm) {
				bestKm = km;
				best = code;
			}
		}
		return best && bestKm <= NEAR_KM ? best : null;
	}

	function mostPopulous(): string | null {
		if (!data) return null;
		let best: string | null = null;
		for (const [code, c] of Object.entries(data.cities)) {
			if (!best || (c.pop ?? 0) > (data.cities[best].pop ?? 0)) best = code;
		}
		return best;
	}

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

	// Resolve the default city. Priority: a stored/clicked pick > the city nearest
	// the visitor's location > the most-populous fallback. While the location is
	// still resolving we show the populous default tentatively, then let a nearby
	// location override it once it arrives (re-runs on userGeo.loc / .resolved).
	$effect(() => {
		if (!data || pinned) return;
		const stored = localStorage.getItem(STORE_KEY);
		if (stored && data.cities[stored]) {
			selected = stored;
			pinned = true;
			return;
		}
		const loc = userGeo.loc;
		if (loc) {
			const near = nearestCity(loc.lat, loc.lng);
			if (near) {
				selected = near;
				return;
			}
		}
		// No usable location (yet, or ever): show the biggest city. Stays unpinned
		// so a location arriving later can still take over.
		if (!selected || userGeo.resolved) selected = mostPopulous();
	});

	function select(code: string) {
		click('open');
		selected = code;
		pinned = true;
		localStorage.setItem(STORE_KEY, code);
	}

	let city = $derived(selected && data ? (data.cities[selected] ?? null) : null);

	let activeTwin = $derived(
		city ? (mode === 'today' ? (city.twin?.today ?? null) : (city.twin?.alltime ?? null)) : null
	);
	let total = $derived(data ? Object.keys(data.cities).length : 0);
	let cityCodes = $derived(data ? new Set(Object.keys(data.cities)) : undefined);
	let slugByCode = $derived(data ? citySlugs(data.cities).slugByCode : {});
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
		<!-- Instant skeleton matching the explorer's final shape (header + histogram)
			so scrolling into view never reveals an empty box or a layout jump. -->
		<div class="min-h-[560px] bg-day-sea px-5 pt-2" aria-hidden="true">
			<div class="mx-auto max-w-2xl motion-safe:animate-pulse">
				<div class="mb-6 h-9 w-2/3 rounded-xs bg-white/25"></div>
				<div class="mb-8 h-8 w-40 rounded-xs bg-white/15"></div>
				<div class="flex items-end gap-1.5">
					{#each Array(28) as _, i (i)}
						<div
							class="flex-1 rounded-xs bg-white/12"
							style="height: {40 + ((i * 37) % 120)}px"
						></div>
					{/each}
				</div>
			</div>
		</div>
	{:else}
		<header
			class="mx-auto mb-7 grid max-w-2xl grid-cols-[minmax(0,1fr)_auto] items-stretch gap-x-6 gap-y-6 px-5 md:items-center md:gap-x-8"
		>
			<div class="flex min-h-[110px] flex-col items-start justify-start text-left">
				<h2 class="m-0 font-bold" style="font-size: clamp(20px, 3.6vw, 38px); line-height: 1.3;">
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

				<div class="mt-5 flex justify-start">
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
						href={`${APP_BASE}/city/${slugByCode[selected] ?? ''}`}
						class="font-bold text-ink underline decoration-ink/40 underline-offset-4 transition-colors duration-120 hover:text-focus"
					>
						City page →
					</a>
				</p>
			</div>

			<div class="flex md:block md:self-end">
				<div
					class="flex bg-day-sea p-2.5 shadow-[3px_3px_0_rgba(11,29,58,0.35)] md:block md:px-4 md:pt-4 md:pb-3 md:shadow-[4px_4px_0_rgba(11,29,58,0.35)]"
				>
					<SkyTwin {city} code={selected} {mode} {data} {india} stations={manifest.stations} />
				</div>
			</div>
		</header>

		<CloudHistogram {data} {selected} {mode} twin={activeTwin} onselect={select} />
	{/if}
</section>
