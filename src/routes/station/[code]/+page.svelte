<script lang="ts">
	// identity prerendered (header instant); only latest + forecast load client-side
	import { onMount } from 'svelte';
	import indiaUrl from '$lib/assets/geo/india.json?url';
	import type { PageData } from './$types';
	import type { FeatureCollection } from 'geojson';
	import type { Topology } from 'topojson-specification';
	import { fetchLatest, fetchForecast, fetchStations, fetchHistory } from '$lib/api/r2';
	import type { AllStations, Forecast, StationsManifest, History } from '$lib/types';
	import { topoToFeatures } from '$lib/map/geo';
	import { resolveActiveDay, computeValues } from '$lib/data';
	import { SITE_BASE } from '$lib/site';
	import SEO from '$lib/components/SEO.svelte';
	import PlacePage from '$lib/components/place/PlacePage.svelte';

	let { data }: { data: PageData } = $props();

	let latest = $state<AllStations>();
	let forecast = $state<Forecast | null>(null);
	let india = $state<FeatureCollection>();
	let manifest = $state<StationsManifest>();
	let record = $state<History>();

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
		fetchHistory(data.code)
			.then((r) => (record = r))
			.catch(() => {});
		try {
			india = topoToFeatures(
				(await fetch(indiaUrl).then((r) => r.json())) as Topology
			);
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

	// primary marker: the station itself
	let stations = $derived([
		{ code: data.code, name: data.name, lat: data.lat, lon: data.lon, km: 0, primary: true }
	]);

	// walk continuous calendar from first to last reading; leave gaps null
	let history = $derived.by(() => {
		const days = record?.days;
		if (!days) return null;
		const keys = Object.keys(days).sort();
		if (!keys.length) return null;
		const dates: string[] = [];
		const e: (number | null)[] = [];
		const end = new Date(keys[keys.length - 1] + 'T00:00:00Z').getTime();
		for (let t = new Date(keys[0] + 'T00:00:00Z').getTime(); t <= end; t += 86_400_000) {
			const iso = new Date(t).toISOString().slice(0, 10);
			dates.push(iso);
			e.push(days[iso]?.e ?? null);
		}
		return { dates, name: data.name, e };
	});

	let dateline = $derived(
		[data.state?.toUpperCase() ?? null, `${data.lat.toFixed(2)}°N ${data.lon.toFixed(2)}°E`]
			.filter(Boolean)
			.join(' · ')
	);
</script>

<SEO
	seoTitle="{data.name} — Mapping India's Clouds"
	seoDescription="Daily cloud-cover reading for the {data.name} IMD station."
	canonicalUrl="{SITE_BASE}/station/{data.code}"
	shareImgPath="{SITE_BASE}/og/home.png"
/>

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
	{history}
/>
