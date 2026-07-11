<script lang="ts">
	// The station's identity (name, state, coords) is prerendered into this page, so
	// the header renders instantly. City-backed stations were already redirected to
	// /city/[slug] at build time (see +page.server.ts), so there's no client redirect
	// dance here — only today's readings + the forecast load client-side.
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import type { FeatureCollection } from 'geojson';
	import type { Topology } from 'topojson-specification';
	import { fetchLatest, fetchForecast, fetchStations } from '$lib/api/r2';
	import type { AllStations, Forecast, StationsManifest } from '$lib/types';
	import { topoToIndia } from '$lib/map/projection';
	import { resolveActiveDay, computeValues } from '$lib/data';
	import PlacePage from '$lib/components/place/PlacePage.svelte';

	let { data }: { data: PageData } = $props();

	let latest = $state<AllStations>();
	let forecast = $state<Forecast | null>(null);
	let india = $state<FeatureCollection>();
	let manifest = $state<StationsManifest>();

	const HOUR_LABELS = ['00', '03', '06', '09', '12', '15', '18', '21'];

	onMount(async () => {
		fetchLatest()
			.then((l) => (latest = l))
			.catch(() => {});
		fetchForecast(data.date, data.code)
			.then((f) => (forecast = f))
			.catch(() => {});
		fetchStations()
			.then((m) => (manifest = m))
			.catch(() => {});
		try {
			india = topoToIndia((await fetch('/data/india.json').then((r) => r.json())) as Topology);
		} catch {}
	});

	let activeDay = $derived(latest ? resolveActiveDay(latest) : null);
	let viewDate = $derived(activeDay?.date ?? data.date);
	let timeIndex = $derived(
		Math.min(7, Math.floor((((Date.now() + 5.5 * 3600 * 1000) / 3600000) % 24) / 3))
	);
	let whenLabel = $derived(`${HOUR_LABELS[timeIndex]}:00 IST`);
	let values = $derived(
		computeValues('today', latest, undefined, timeIndex, 0, activeDay?.index ?? 0)
	);
	let todayValues = $derived(values[data.code] ?? null);

	// The station itself is the map's primary marker (gold dot + its own clouds).
	let stations = $derived([
		{ code: data.code, name: data.name, lat: data.lat, lon: data.lon, km: 0, primary: true }
	]);

	let dateline = $derived(
		[
			data.state?.toUpperCase() ?? null,
			`${data.lat.toFixed(2)}°N ${data.lon.toFixed(2)}°E`
		]
			.filter(Boolean)
			.join(' · ')
	);
</script>

<svelte:head>
	<title>{data.name} — Reading the Clouds</title>
	<meta name="description" content="Daily cloud-cover reading for an IMD station." />
</svelte:head>

<PlacePage
	mode="station"
	name={data.name}
	{dateline}
	values={todayValues}
	stationName={data.name}
	km={null}
	date={viewDate}
	when={whenLabel}
	{forecast}
	metDate={data.date}
	metCode={data.code}
	{india}
	{stations}
	cities={data.cities}
	perStation={values}
	stationLookup={manifest?.stations}
/>
