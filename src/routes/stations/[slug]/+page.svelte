<script lang="ts">
	import type { PageData } from './$types';
	import { indiaFeatures } from '$lib/map/india';
	import { resolveActiveDay, computeValues } from '$lib/data';
	import { SITE_BASE } from '$lib/site';
	import SEO from '$lib/components/SEO.svelte';
	import PlacePage from '$lib/components/place/PlacePage.svelte';

	let { data }: { data: PageData } = $props();

	const HOUR_LABELS = ['00', '03', '06', '09', '12', '15', '18', '21'];

	// everything below is baked into the prerender; the live 3-hour column and day are
	// picked client-side from the visitor's clock, and the scrubber can override them —
	// still all from baked data, no client fetch.
	let latest = $derived(data.latest);
	let days = $derived([latest.date, ...(latest.fdays ?? [])]);
	let activeDay = $derived(resolveActiveDay(latest));
	let liveDayIndex = $derived(activeDay.index);
	let liveTimeIndex = $derived(
		Math.min(7, Math.floor((((Date.now() + 5.5 * 3600 * 1000) / 3600000) % 24) / 3))
	);

	// null = follow the live clock; set once the visitor scrubs, cleared by "NOW".
	let picked = $state<{ day: number; time: number } | null>(null);
	let dayIndex = $derived(picked ? picked.day : liveDayIndex);
	let timeIndex = $derived(picked ? picked.time : liveTimeIndex);
	let isLive = $derived(
		picked === null || (picked.day === liveDayIndex && picked.time === liveTimeIndex)
	);

	let viewDate = $derived(days[dayIndex] ?? activeDay.date);
	let whenLabel = $derived(`${HOUR_LABELS[timeIndex]}:00 IST`);
	let values = $derived(computeValues('today', latest, undefined, timeIndex, 0, dayIndex));
	let todayValues = $derived(values[data.code] ?? null);

	let dateline = $derived(
		[
			[
				data.district && data.district.toLowerCase() !== data.name.toLowerCase()
					? data.district
					: null,
				data.state
			]
				.filter(Boolean)
				.join(', ')
				.toUpperCase() || null,
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
	canonicalUrl="{SITE_BASE}/stations/{data.slug}"
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
	metCaption="NEXT 10 DAYS,  3-HOURLY"
	perStation={values}
	india={indiaFeatures}
	stations={data.stations}
	stationLookup={data.stationLookup}
	history={data.history}
	{days}
	{dayIndex}
	{timeIndex}
	{isLive}
	liveDay={liveDayIndex}
	liveTime={liveTimeIndex}
	onTime={(d, t) => (picked = { day: d, time: t })}
	onNow={() => (picked = null)}
/>
