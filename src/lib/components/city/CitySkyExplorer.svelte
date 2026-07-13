<script lang="ts">
	import type { StationsManifest, CitiesRollup } from '$lib/types';
	import type { FeatureCollection } from 'geojson';
	import { fetchCities } from '$lib/api/r2';
	import { citySlugs } from '$lib/city/slug.js';
	import { haversineKm } from '$lib/city/distance';
	import { userGeo } from '$lib/state/geo.svelte';
	import { citySky } from '$lib/state/citySky.svelte';
	import { base as APP_BASE } from '$app/paths';
	import { click } from '$lib/feedback';
	import StationSearch from '$lib/components/StationSearch.svelte';
	import PixelButton from '$lib/components/PixelButton.svelte';
	import { TabSwitch } from '$lib/components/ui/switch';
	import { fade } from 'svelte/transition';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { Cancel01Icon, ArrowRight01Icon, ArrowDown01Icon } from '@hugeicons/core-free-icons';
	import CloudHistogram from './CloudHistogram.svelte';
	import SkyTwin from './SkyTwin.svelte';

	interface Props {
		manifest: StationsManifest;
		places?: FeatureCollection;
		india: FeatureCollection;
	}
	let { manifest, places, india }: Props = $props();

	// Max distance (km) from the visitor to their nearest city for us to default to
	// it — beyond this (e.g. an overseas visitor) we fall back to the biggest city.
	const NEAR_KM = 250;

	let data = $state<CitiesRollup | null>(null);
	let failed = $state(false);
	// Focus lives in shared state so the intro barcode stays in sync; `selected` is
	// a read-only alias to keep the template terse.
	let selected = $derived(citySky.code);
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

	// Prefetch the city record during idle right after mount — well before the reader
	// scrolls down — so the explorer is ready when it enters view rather than showing
	// a placeholder and fetching on demand. The timeout guarantees it fires even if
	// the map keeps the main thread busy; an IntersectionObserver still short-circuits
	// the wait if the reader scrolls straight down.
	let fetchStarted = false;
	function loadCities() {
		if (fetchStarted || data || failed) return;
		fetchStarted = true;
		fetchCities()
			.then((d) => (data = d))
			.catch(() => (failed = true));
	}

	$effect(() => {
		if (data || failed) return;
		const w = window as unknown as {
			requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
			cancelIdleCallback?: (id: number) => void;
		};
		let idleId = 0;
		let timer: ReturnType<typeof setTimeout> | undefined;
		if (w.requestIdleCallback) idleId = w.requestIdleCallback(loadCities, { timeout: 1500 });
		else timer = setTimeout(loadCities, 500);

		// Reader reached it before the idle prefetch fired: fetch immediately.
		const io = root
			? new IntersectionObserver(
					(entries) => {
						if (entries.some((e) => e.isIntersecting)) loadCities();
					},
					{ rootMargin: '600px' }
				)
			: null;
		if (io && root) io.observe(root);

		return () => {
			if (idleId && w.cancelIdleCallback) w.cancelIdleCallback(idleId);
			if (timer) clearTimeout(timer);
			io?.disconnect();
		};
	});

	$effect(() => {
		if (!data || citySky.pinned) return;
		const loc = userGeo.loc;
		if (loc) {
			const near = nearestCity(loc.lat, loc.lng);
			if (near) {
				citySky.suggest(near);
				return;
			}
		}

		if (!citySky.code || userGeo.resolved) {
			const pop = mostPopulous();
			if (pop) citySky.suggest(pop);
		}
	});

	function select(code: string) {
		click('open');
		citySky.pick(code);
	}

	// Drop the highlighted city so the reader sees the whole front on its own; the
	// graph still plots every city and a cloud-click (or the search) re-selects one.
	function clearCity() {
		click('select');
		citySky.clear();
	}

	let city = $derived(selected && data ? (data.cities[selected] ?? null) : null);

	let activeTwin = $derived(
		city ? (mode === 'today' ? (city.twin?.today ?? null) : (city.twin?.alltime ?? null)) : null
	);
	let cityCodes = $derived(data ? new Set(Object.keys(data.cities)) : undefined);
	let slugByCode = $derived(data ? citySlugs(data.cities).slugByCode : {});
</script>

<section
	bind:this={root}
	id="city-explorer"
	class="scroll-mt-4 pt-2"
	aria-label="City sky explorer"
>
	{#if failed}
		<p class="px-5 text-center text-xs tracking-wider text-error-tint uppercase">
			Couldn't load the city record — try again later.
		</p>
	{:else if !data}
		<!-- Skeleton mirrors the loaded layout box-for-box. The twin-map box (right) drives
		     the header height via the same aspect ratio, and the histogram uses the same
		     fixed height, so swapping in the real content causes zero layout shift. -->
		<div class="motion-safe:animate-pulse" aria-hidden="true">
			<header
				class="mx-auto mb-7 grid max-w-2xl grid-cols-[minmax(0,1fr)_auto] items-stretch gap-x-6 gap-y-6 px-5 md:items-center md:gap-x-8"
			>
				<div class="flex min-h-[110px] flex-col items-start justify-start">
					<div class="w-full space-y-2.5">
						<div class="h-6 w-4/5 rounded-xs bg-ink/10 md:h-8"></div>
						<div class="h-6 w-3/5 rounded-xs bg-ink/10 md:h-8"></div>
					</div>
					<div class="mt-5 h-9 w-40 rounded-xs bg-ink/10"></div>
					<div class="mt-4 flex gap-2">
						<div class="h-8 w-28 rounded-xs bg-ink/10"></div>
						<div class="h-8 w-20 rounded-xs bg-ink/10"></div>
					</div>
				</div>

				<div class="flex md:block md:self-end">
					<div
						class="flex bg-day-sea p-2.5 shadow-[3px_3px_0_rgba(11,29,58,0.35)] md:block md:px-4 md:pt-4 md:pb-3 md:shadow-[4px_4px_0_rgba(11,29,58,0.35)]"
					>
						<div class="w-[132px] md:w-[180px]">
							<div class="w-full bg-white/10" style="aspect-ratio: 1024 / 1194;"></div>
							<div class="mt-2 min-h-[3.5em] space-y-1.5 text-[11px] md:text-sm">
								<div class="h-3 w-full rounded-xs bg-white/15"></div>
								<div class="h-3 w-2/3 rounded-xs bg-white/15"></div>
							</div>
						</div>
					</div>
				</div>
			</header>

			<div class="h-[320px] w-full bg-day-sea sm:h-[400px]"></div>
		</div>
	{:else}
		<div in:fade={{ duration: 220 }}>
			<header
				class="mx-auto mb-7 grid max-w-2xl grid-cols-[minmax(0,1fr)_auto] items-stretch gap-x-6 gap-y-6 px-5 md:items-center md:gap-x-8"
			>
				<div class="flex min-h-[110px] flex-col items-start justify-start text-left">
					<h2
						class="m-0 min-w-0 font-bold"
						style="font-size: clamp(24px, 3.6vw, 38px); line-height: 1.3;"
					>
						{#if city}
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
										class="block max-w-40 cursor-pointer truncate overflow-x-clip border-b-4 border-sun-gold p-0 px-1 text-left align-baseline font-bold text-ink uppercase transition-colors duration-120 hover:text-focus md:max-w-full"
									>
										{city.name}
										<HugeiconsIcon
											icon={ArrowDown01Icon}
											size={16}
											strokeWidth={2.5}
											class="ml-0.5 inline-block align-middle"
											aria-hidden="true"
										/>
									</button>
								{/snippet}
							</StationSearch>
						{:else}
							How cloudy <br /> has it been across India?
						{/if}
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

					<div class="mt-4 flex flex-wrap items-center gap-2 text-left">
						{#if city}
							<PixelButton
								href={`${APP_BASE}/city/${slugByCode[selected!] ?? ''}`}
								cap="paper"
								size="xs"
								class="text-sm!"
							>
								<span class="flex items-center gap-1">
									{city.name} page
									<HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2.4} size={14} />
								</span>
							</PixelButton>
							<PixelButton
								cap="paper"
								size="xs"
								class="text-sm!"
								onclick={clearCity}
								aria-label="Clear the selected city"
							>
								<span class="flex items-center gap-1">
									<HugeiconsIcon icon={Cancel01Icon} strokeWidth={2.4} size={13} />
									Clear
								</span>
							</PixelButton>
						{:else}
							<StationSearch
								{manifest}
								{places}
								codes={cityCodes}
								cityFirst
								side="bottom"
								align="start"
								onselect={select}
							/>
							<span class="text-xs tracking-wider text-ink/55 uppercase">
								or tap any cloud below
							</span>
						{/if}
					</div>
				</div>

				<div class="flex md:block md:self-end">
					<div
						class="flex bg-day-sea p-2.5 shadow-[3px_3px_0_rgba(11,29,58,0.35)] md:block md:px-4 md:pt-4 md:pb-3 md:shadow-[4px_4px_0_rgba(11,29,58,0.35)]"
					>
						<SkyTwin {city} code={selected} {mode} {data} {india} stations={manifest.stations} />
					</div>
				</div>
			</header>

			<CloudHistogram {data} selected={selected ?? ''} {mode} twin={activeTwin} onselect={select} />
		</div>
	{/if}
</section>
