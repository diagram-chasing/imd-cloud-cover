<script lang="ts">
	import type { PageData } from './$types';
	import { indiaFeatures } from '$lib/map/india';
	import { resolveActiveDay, computeValues } from '$lib/data';
	import { SITE_BASE } from '$lib/site';
	import SEO from '$lib/components/SEO.svelte';
	import PlacePage from '$lib/components/place/PlacePage.svelte';

	let { data }: { data: PageData } = $props();

	const HOUR_LABELS = ['00', '03', '06', '09', '12', '15', '18', '21'];

	// everything below is baked into the prerender; only the *current* 3-hour
	// column is picked client-side from the visitor's clock.
	let latest = $derived(data.latest);
	let activeDay = $derived(resolveActiveDay(latest));
	let viewDate = $derived(activeDay.date);
	let timeIndex = $derived(
		Math.min(7, Math.floor((((Date.now() + 5.5 * 3600 * 1000) / 3600000) % 24) / 3))
	);
	let whenLabel = $derived(`${HOUR_LABELS[timeIndex]}:00 IST`);
	let values = $derived(computeValues('today', latest, undefined, timeIndex, 0, activeDay.index));
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

<SEO
	seoTitle={data.og.title}
	seoDescription={data.og.description}
	canonicalUrl="{SITE_BASE}/city/{data.slug}"
	shareImgPath="{SITE_BASE}/og/{data.slug}.png"
/>

<PlacePage
	mode="city"
	name={data.name}
	{dateline}
	values={todayValues}
	stationName={data.stationName}
	km={data.primaryKm}
	date={viewDate}
	when={whenLabel}
	forecast={data.forecast}
	metDate={data.date}
	metCode={data.code}
	metCaption="NEXT 10 DAYS,  3-HOURLY. READING FROM {data.stationName.toUpperCase()}"
	perStation={values}
	india={indiaFeatures}
	cityPoint={data.lat != null && data.lon != null
		? { name: data.name, lat: data.lat, lon: data.lon }
		: null}
	stations={data.stations}
	slugByCode={data.slugByCode}
	stationLookup={data.stationLookup}
	history={data.history}
/>
