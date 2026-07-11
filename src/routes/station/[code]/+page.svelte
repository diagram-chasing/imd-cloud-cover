<script lang="ts">
	// The station's identity (name, state, coords) is prerendered into this page, so
	// the header renders instantly. City-backed stations were already redirected to
	// /city/[slug] at build time (see +page.server.ts), so there's no client redirect
	// dance here — only today's readings + the forecast load client-side.
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import { fetchLatest, fetchForecast } from '$lib/api/r2';
	import type { AllStations, Forecast } from '$lib/types';
	import { resolveActiveDay, computeValues } from '$lib/data';
	import PlacePage from '$lib/components/place/PlacePage.svelte';

	let { data }: { data: PageData } = $props();

	let latest = $state<AllStations>();
	let forecast = $state<Forecast | null>(null);

	const HOUR_LABELS = ['00', '03', '06', '09', '12', '15', '18', '21'];

	onMount(() => {
		fetchLatest()
			.then((l) => (latest = l))
			.catch(() => {});
		fetchForecast(data.date, data.code)
			.then((f) => (forecast = f))
			.catch(() => {});
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

	let dateline = $derived(
		[
			'STATION',
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
/>
