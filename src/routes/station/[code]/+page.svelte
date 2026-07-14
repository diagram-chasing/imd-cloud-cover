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
			data.stationCount > 1
				? `${data.stationCount} NEARBY STATION${data.stationCount === 1 ? '' : 'S'}`
				: null,
			`${data.lat.toFixed(2)}°N ${data.lon.toFixed(2)}°E`
		]
			.filter(Boolean)
			.join(' · ')
	);
</script>

<SEO
	seoTitle="{data.name} — Mapping India's Clouds"
	seoDescription="Daily cloud-cover reading for the {data.name} IMD station."
	canonicalUrl="{SITE_BASE}/station/{data.code}"
	shareImgPath="{SITE_BASE}/og/{data.code}.png"
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
	stations={data.stations}
	perStation={values}
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
