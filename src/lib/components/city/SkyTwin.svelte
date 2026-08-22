<script lang="ts">
	import type { CitiesRollup, CityStats, Station } from '$lib/types';
	import type { FeatureCollection } from 'geojson';
	import TwinMap from './TwinMap.svelte';

	interface Props {
		/** null when no city is focused — the map still renders as a dimmed empty state. */
		city: CityStats | null;
		code: string | null;
		data: CitiesRollup;
		india: FeatureCollection;
		stations: Record<string, Station>;
		mode?: 'today' | 'overall';
		/** Twin-finding on/off — off shows just the focused city, no match. */
		enabled?: boolean;
	}
	let { city, code, data, india, stations, mode = 'overall', enabled = true }: Props = $props();

	// Latest reading in the daily series — same convention as the histogram.
	function todayVal(c: CityStats): number {
		for (let i = c.e.length - 1; i >= 0; i--) if (c.e[i] != null) return c.e[i] as number;
		return c.mean;
	}

	function resolve(ref: { code: string } | null | undefined) {
		if (!ref) return null;
		const c = data.cities[ref.code];
		const st = stations[ref.code];
		return c && st ? { code: ref.code, name: c.name, lat: st.lat, lon: st.lon } : null;
	}
	let twin = $derived(
		enabled && city ? resolve(mode === 'today' ? city.twin?.today : city.twin?.alltime) : null
	);

	let pins = $derived.by(() => {
		const me = city && code ? stations[code] : null;
		if (!me || !city) return [];
		const out = [{ code: code!, label: city.name, lat: me.lat, lon: me.lon, accent: true }];
		if (twin) out.push({ code: twin.code, label: twin.name, lat: twin.lat, lon: twin.lon, accent: false });
		return out;
	});
</script>

<div class="twin flex h-full w-[132px] flex-col text-white md:block md:w-[180px]">
	<div
		class={[
			'transition-[filter,opacity] duration-200',
			(!city || (enabled && !twin)) && 'opacity-60 grayscale'
		]}
	>
		<TwinMap {india} {pins} />
	</div>
	<p
		class="m-0 mt-2 min-h-[3.5em] text-sm leading-snug font-bold uppercase text-shadow-sky md:text-sm md:leading-relaxed"
	>
		{#if !city}
			Pick a city to find its match.
		{:else if !enabled && mode === 'today'}
			{@const val = Math.round(todayVal(city))}
			{@const diff = val - city.mean}
			{#if diff > 8}
				Cloudier than usual today at <span class="text-sun-gold">{val}%</span>.
			{:else if diff < -8}
				Clearer than usual today at <span class="text-sun-gold">{val}%</span>.
			{:else}
				A typical day for this place at <span class="text-sun-gold">{val}%</span>.
			{/if}
		{:else if !enabled}
			Clouds cover <span class="text-sun-gold">{Math.round(city.mean)}%</span> of this place on an
			average day.
		{:else if twin && mode === 'today'}
			Today, this place matches <span class="text-sun-gold">{twin.name}</span>.
		{:else if twin}
			Over the last year, this place matched <span class="text-sun-gold">{twin.name}</span>.
		{:else if mode === 'today'}
			No city matches {city.name}'s sky today.
		{:else}
			No sky twin for {city.name}.
		{/if}
	</p>
</div>
