<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import type { FeatureCollection } from 'geojson';
	import type { Topology } from 'topojson-specification';
	import type { StationsManifest, AllStations, Summary, Forecast } from '$lib/types';
	import { fetchStations, fetchLatest, fetchSummary, fetchForecast, fetchCities } from '$lib/api/r2';
	import { topoToIndia } from '$lib/map/projection';
	import { resolveActiveDay, computeValues } from '$lib/data';
	import { citySlugs } from '$lib/city/slug.js';
	import { SITE_BASE } from '$lib/site';
	import PlacePage from '$lib/components/place/PlacePage.svelte';

	let { data }: { data: PageData } = $props();

	let manifest = $state<StationsManifest>();
	let latest = $state<AllStations>();
	let summary = $state<Summary>();
	let forecast = $state<Forecast | null>(null);
	let india = $state<FeatureCollection>();
	let slugByCode = $state<Record<string, string>>({});

	const HOUR_LABELS = ['00', '03', '06', '09', '12', '15', '18', '21'];

	onMount(async () => {
		try {
			[manifest, latest, summary] = await Promise.all([
				fetchStations(),
				fetchLatest(),
				fetchSummary()
			]);
			india = topoToIndia((await fetch('/data/india.json').then((r) => r.json())) as Topology);
			fetchCities()
				.then((c) => (slugByCode = citySlugs(c.cities).slugByCode))
				.catch(() => {});
			fetchForecast(data.date, data.code)
				.then((f) => (forecast = f))
				.catch(() => {});
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

	let dateline = $derived(
		[
			data.state?.toUpperCase() ?? null,
			data.stationCount
				? `${data.stationCount} NEARBY STATION${data.stationCount === 1 ? '' : 'S'}`
				: null,
			data.lat != null && data.lon != null
				? `${data.lat.toFixed(2)}°N ${data.lon.toFixed(2)}°E`
				: null
		]
			.filter(Boolean)
			.join(' , ')
	);
</script>

<svelte:head>
	<title>{data.og.title}</title>
	<meta name="description" content={data.og.description} />
	<meta property="og:title" content={data.og.title} />
	<meta property="og:description" content={data.og.description} />
	<meta property="og:image" content="{SITE_BASE}/og/{data.slug}.png" />
	<meta property="og:url" content="{SITE_BASE}/city/{data.slug}" />
	<meta property="og:type" content="website" />
	<meta name="twitter:card" content="summary_large_image" />
	<link rel="canonical" href="{SITE_BASE}/city/{data.slug}" />
</svelte:head>

<PlacePage
	mode="city"
	name={data.name}
	{dateline}
	values={todayValues}
	stationName={data.stationName}
	km={data.primaryKm}
	date={viewDate}
	when={whenLabel}
	{forecast}
	metDate={data.date}
	metCode={data.code}
	metCaption="NEXT 10 DAYS · 3-HOURLY · READ FROM {data.stationName.toUpperCase()}"
	perStation={values}
	{india}
	cityPoint={data.lat != null && data.lon != null
		? { name: data.name, lat: data.lat, lon: data.lon }
		: null}
	stations={data.stations}
	{slugByCode}
	stationLookup={manifest?.stations}
/>
