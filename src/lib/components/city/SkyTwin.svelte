<script lang="ts">
	import type { CitiesRollup, CityStats, Station } from '$lib/types';
	import type { FeatureCollection } from 'geojson';
	import TwinMap from './TwinMap.svelte';

	interface Props {
		city: CityStats;
		code: string;
		data: CitiesRollup;
		india: FeatureCollection;
		stations: Record<string, Station>;
		mode?: 'today' | 'overall';
	}
	let { city, code, data, india, stations, mode = 'overall' }: Props = $props();

	function resolve(ref: { code: string } | null | undefined) {
		if (!ref) return null;
		const c = data.cities[ref.code];
		const st = stations[ref.code];
		return c && st ? { code: ref.code, name: c.name, lat: st.lat, lon: st.lon } : null;
	}
	let twin = $derived(resolve(mode === 'today' ? city.twin?.today : city.twin?.alltime));

	let pins = $derived.by(() => {
		const me = stations[code];
		if (!me) return [];
		const out = [{ label: city.name, lat: me.lat, lon: me.lon, accent: true }];
		if (twin) out.push({ label: twin.name, lat: twin.lat, lon: twin.lon, accent: false });
		return out;
	});
</script>

<div class="twin flex h-full w-[132px] flex-col text-white md:block md:w-[180px]">
	<div class={['transition-[filter,opacity] duration-200', !twin && 'opacity-60 grayscale']}>
		<TwinMap {india} {pins} />
	</div>
	<p
		class="m-0 mt-2 min-h-[3.5em] text-[11px] leading-snug font-bold uppercase text-shadow-sky md:text-sm md:leading-relaxed"
	>
		{#if twin && mode === 'today'}
			Today, this sky matches <span class="text-sun-gold">{twin.name}</span>.
		{:else if twin}
			Over the last year, this sky's matched <span class="text-sun-gold">{twin.name}</span>.
		{:else if mode === 'today'}
			No city shares {city.name}'s sky today.
		{:else}
			No sky twin for {city.name}.
		{/if}
	</p>
</div>
