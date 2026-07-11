<script lang="ts">
	// Station deep-links resolve to the canonical /city/[slug] page when the station
	// backs a city (redirect). The ~2/3 with no city render the shared PlacePage in
	// station mode — the city page scoped to one point: no locator map, no list.
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { base as APP_BASE } from '$app/paths';
	import { fetchStations, fetchLatest, fetchSummary, fetchCities, fetchForecast } from '$lib/api/r2';
	import type { StationsManifest, AllStations, Summary, Forecast, Station } from '$lib/types';
	import { resolveActiveDay, computeValues } from '$lib/data';
	import { citySlugs } from '$lib/city/slug.js';
	import PlacePage from '$lib/components/place/PlacePage.svelte';

	let code = $derived(page.params.code?.toUpperCase() ?? '');

	let resolving = $state(true);
	let manifest = $state<StationsManifest>();
	let latest = $state<AllStations>();
	let summary = $state<Summary>();
	let forecast = $state<Forecast | null>(null);
	let error = $state<string | null>(null);

	const HOUR_LABELS = ['00', '03', '06', '09', '12', '15', '18', '21'];

	onMount(async () => {
		try {
			// Redirect to the city page if this station backs one.
			const cities = await fetchCities().catch(() => null);
			if (cities) {
				const slug = citySlugs(cities.cities).slugByCode[code];
				if (slug) {
					goto(`${APP_BASE}/city/${slug}`, { replaceState: true });
					return;
				}
			}
			// Otherwise fall back to a station-scoped place page.
			[manifest, latest, summary] = await Promise.all([
				fetchStations(),
				fetchLatest(),
				fetchSummary()
			]);
			if (summary?.date) {
				fetchForecast(summary.date, code)
					.then((f) => (forecast = f))
					.catch(() => {});
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load station data';
		} finally {
			resolving = false;
		}
	});

	let station = $derived<Station | null>(manifest ? (manifest.stations[code] ?? null) : null);
	let activeDay = $derived(latest ? resolveActiveDay(latest) : null);
	let viewDate = $derived(activeDay?.date ?? summary?.date ?? '');
	let timeIndex = $derived(
		Math.min(7, Math.floor((((Date.now() + 5.5 * 3600 * 1000) / 3600000) % 24) / 3))
	);
	let whenLabel = $derived(`${HOUR_LABELS[timeIndex]}:00 IST`);
	let values = $derived(
		computeValues('today', latest, undefined, timeIndex, 0, activeDay?.index ?? 0)
	);
	let todayValues = $derived(values[code] ?? null);

	let dateline = $derived(
		station
			? ['STATION', station.state?.toUpperCase() ?? null, `${station.lat.toFixed(2)}°N ${station.lon.toFixed(2)}°E`]
					.filter(Boolean)
					.join(' · ')
			: 'STATION'
	);
</script>

<svelte:head>
	<title>{station?.name ?? code} — Reading the Clouds</title>
	<meta name="description" content="Daily cloud-cover reading for an IMD station." />
</svelte:head>

{#if station && summary}
	<PlacePage
		mode="station"
		name={station.name}
		{dateline}
		values={todayValues}
		stationName={station.name}
		km={null}
		date={viewDate}
		when={whenLabel}
		{forecast}
		metDate={summary.date}
		metCode={code}
	/>
{:else}
	<main class="mx-auto max-w-[660px] px-5 pt-6 pb-18">
		<a
			class="mb-7 inline-block text-xs tracking-wide text-ink no-underline opacity-70 transition-opacity hover:opacity-100"
			href="/">← BACK TO THE MAP</a
		>
		{#if error}
			<p class="text-sm">Couldn’t load this station: {error}</p>
		{:else if manifest && !station}
			<p class="text-sm">No station “{code}”.</p>
		{:else if !resolving}
			<p class="text-sm">No station “{code}”.</p>
		{:else}
			<p class="text-sm">Reading the skies…</p>
		{/if}
	</main>
{/if}
