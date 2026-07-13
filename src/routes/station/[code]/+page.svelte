<script lang="ts">
	// fully prerendered: reading, map, forecast and history are baked; only the
	// current 3-hour column is picked client-side from the visitor's clock.
	import type { PageData } from './$types';
	import { indiaFeatures } from '$lib/map/india';
	import { resolveActiveDay, computeValues } from '$lib/data';
	import { SITE_BASE } from '$lib/site';
	import SEO from '$lib/components/SEO.svelte';
	import PlacePage from '$lib/components/place/PlacePage.svelte';

	let { data }: { data: PageData } = $props();

	const HOUR_LABELS = ['00', '03', '06', '09', '12', '15', '18', '21'];

	let latest = $derived(data.latest);
	let activeDay = $derived(resolveActiveDay(latest));
	let viewDate = $derived(activeDay.date);
	let timeIndex = $derived(
		Math.min(7, Math.floor((((Date.now() + 5.5 * 3600 * 1000) / 3600000) % 24) / 3))
	);
	let whenLabel = $derived(`${HOUR_LABELS[timeIndex]}:00 IST`);
	let values = $derived(computeValues('today', latest, undefined, timeIndex, 0, activeDay.index));
	let todayValues = $derived(values[data.code] ?? null);

	// primary marker: the station itself
	let stations = $derived([
		{ code: data.code, name: data.name, lat: data.lat, lon: data.lon, km: 0, primary: true }
	]);

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
	forecast={data.forecast}
	metDate={data.date}
	metCode={data.code}
	india={indiaFeatures}
	{stations}
	cities={data.cities}
	perStation={values}
	stationLookup={data.stationLookup}
	history={data.history}
/>
