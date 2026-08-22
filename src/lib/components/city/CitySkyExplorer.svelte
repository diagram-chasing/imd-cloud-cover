<script lang="ts">
	import type { StationsManifest, CitiesRollup } from '$lib/types';
	import type { FeatureCollection } from 'geojson';
	import { fetchCities } from '$lib/api/r2';
	import { citySlugs } from '$lib/stations/slug.js';
	import { withStateTag } from '$lib/stations/labels';
	import { haversineKm } from '$lib/stations/distance';
	import { userGeo } from '$lib/state/geo.svelte';
	import { citySky } from '$lib/state/citySky.svelte';
	import { base as APP_BASE } from '$app/paths';
	import { click } from '$lib/feedback';
	import StationSearch from '$lib/components/StationSearch.svelte';
	import PixelButton from '$lib/components/PixelButton.svelte';
	import { TabSwitch } from '$lib/components/ui/switch';
	import { fade } from 'svelte/transition';
	import { SKY } from '$lib/theme';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { Cancel01Icon, ArrowRight01Icon, ArrowDown01Icon } from '@hugeicons/core-free-icons';
	import CloudHistogram from './CloudHistogram.svelte';
	import SkyTwin from './SkyTwin.svelte';

	interface Props {
		manifest: StationsManifest;
		india: FeatureCollection;
	}
	let { manifest, india }: Props = $props();

	// Max distance (km) from the visitor to their nearest city for us to default to
	// it — beyond this (e.g. an overseas visitor) we fall back to the biggest city.
	const NEAR_KM = 250;

	let data = $state<CitiesRollup | null>(null);
	let failed = $state(false);
	// Focus lives in shared state so the intro barcode stays in sync; `selected` is
	// a read-only alias to keep the template terse.
	let selected = $derived(citySky.code);
	let mode = $state<'today' | 'overall'>('overall');
	// Twin-finding on/off — the switch lives on the twin box; off just spotlights
	// the chosen city (no match on the map, no twin marker in the histogram).
	let twinOn = $state(true);
	let root = $state<HTMLElement>();

	// Kick off the coarse (IP) location fetch as soon as the explorer mounts.
	$effect(() => {
		userGeo.ensure();
	});

	function nearestCity(lat: number, lng: number): { code: string; km: number } | null {
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
		return best ? { code: best, km: bestKm } : null;
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
			if (near && near.km <= NEAR_KM) {
				citySky.suggest(near.code);
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

	function toggleTwin() {
		click('select');
		twinOn = !twinOn;
	}

	// "My location" in the search: an explicit ask, so skip the NEAR_KM cap and
	// take the nearest city outright.
	function selectNearest() {
		const loc = userGeo.loc;
		if (!loc) return;
		const near = nearestCity(loc.lat, loc.lng);
		if (near) select(near.code);
	}

	let city = $derived(selected && data ? (data.cities[selected] ?? null) : null);

	let activeTwin = $derived(
		twinOn && city
			? mode === 'today'
				? (city.twin?.today ?? null)
				: (city.twin?.alltime ?? null)
			: null
	);
	let cityCodes = $derived(data ? new Set(Object.keys(data.cities)) : undefined);
	let slugByCode = $derived(data ? citySlugs(data.cities).slugByCode : {});
</script>

<section
	bind:this={root}
	id="city-explorer"
	class="scroll-mt-4 overflow-x-clip pt-2"
	aria-label="Station sky explorer"
>
	{#if failed}
		<p class="px-5 text-center text-xs tracking-wider text-error-tint uppercase">
			Couldn't load the station record — try again later.
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

			<div class="h-[358px] w-full sm:h-[438px]" style="background: #3a88cc;"></div>
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
								codes={cityCodes}
								cityFirst
								side="bottom"
								align="start"
								onselect={select}
								onmylocation={selectNearest}
							>
								{#snippet trigger(props)}
									{@const label = withStateTag(city.name, city.state)}
									<button
										{...props}
										class="block max-w-40 cursor-pointer truncate overflow-x-clip border-b-4 border-sun-gold p-0 px-1 text-left align-baseline font-bold text-ink uppercase transition-colors duration-120 hover:text-focus md:max-w-full"
										style={label.length > 24
											? 'font-size: 0.58em'
											: label.length > 16
												? 'font-size: 0.74em'
												: undefined}
									>
										{label}
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
								href={`${APP_BASE}/stations/${slugByCode[selected!] ?? ''}`}
								cap="gold"
								size="xs"
								class="text-sm!"
							>
								<span class="flex items-center gap-1">
									Go to page
									<HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2.4} size={14} />
								</span>
							</PixelButton>
						{:else}
							<StationSearch
								{manifest}
								codes={cityCodes}
								cityFirst
								side="bottom"
								align="start"
								onselect={select}
								onmylocation={selectNearest}
							/>
							<span class="text-xs text-ink/85 uppercase"> or tap any cloud below </span>
						{/if}
					</div>
				</div>

				<div class="flex md:block md:self-end">
					<div
						class="flex bg-day-sea p-2.5 shadow-[3px_3px_0_rgba(11,29,58,0.35)] md:block md:px-4 md:pt-4 md:pb-3 md:shadow-[4px_4px_0_rgba(11,29,58,0.35)]"
					>
						<SkyTwin
							{city}
							code={selected}
							{mode}
							{data}
							{india}
							stations={manifest.stations}
							enabled={twinOn}
						/>
					</div>
				</div>
			</header>

			<!-- Chart controls ride the chart itself, centered in a band that shares the
			     canvas fill so it reads as extra sky. Always rendered (invisible without a
			     city) so selecting/clearing never shifts the chart. -->
			<div
				class="flex items-center justify-center gap-4 pt-4 pb-1"
				style="background: {SKY.day.top};"
			>
				<button
					type="button"
					class="chart-chip"
					class:invisible={!city}
					onclick={clearCity}
					aria-label="Clear the selected station"
				>
					<HugeiconsIcon icon={Cancel01Icon} strokeWidth={2.6} size={12} aria-hidden="true" />
					Clear
				</button>
				<button
					type="button"
					role="switch"
					aria-checked={twinOn}
					class="chart-chip"
					class:invisible={!city}
					onclick={toggleTwin}
				>
					Sky twin
					<span class="track" aria-hidden="true"><span class="knob"></span></span>
				</button>
			</div>
			<CloudHistogram {data} selected={selected ?? ''} {mode} twin={activeTwin} onselect={select} />
		</div>
	{/if}
</section>

<style>
	/* Same recipe as the histogram's .tag chips, so the pair reads as part of the chart. */
	.chart-chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 5px 9px;
		border: 0;
		background: color-mix(in srgb, var(--color-navy) 84%, transparent);
		box-shadow: 2px 2px 0 color-mix(in srgb, var(--color-navy) 35%, transparent);
		color: #fff;
		font-family: inherit;
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.08em;
		line-height: 1.15;
		text-transform: uppercase;
		cursor: pointer;
		user-select: none;
		touch-action: manipulation;
		-webkit-tap-highlight-color: transparent;
		transition: color 120ms ease;
	}
	.chart-chip:hover {
		color: var(--sun-gold);
	}
	.track {
		position: relative;
		width: 26px;
		height: 14px;
		background: rgba(255, 255, 255, 0.28);
		transition: background-color 160ms ease;
	}
	.knob {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 10px;
		height: 10px;
		background: #fff;
		transition:
			transform 200ms cubic-bezier(0.22, 1, 0.36, 1),
			background-color 160ms ease;
	}
	.chart-chip[aria-checked='true'] .track {
		background: var(--sun-gold);
	}
	.chart-chip[aria-checked='true'] .knob {
		transform: translateX(12px);
		background: var(--navy);
	}
	@media (prefers-reduced-motion: reduce) {
		.track,
		.knob {
			transition: none;
		}
	}
</style>
