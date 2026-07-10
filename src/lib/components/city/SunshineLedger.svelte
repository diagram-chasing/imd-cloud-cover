<script lang="ts">
	import type { CityStats } from '$lib/types';
	import { prettyDay } from '$lib/format';
	import { CLEAR_STARS } from '$lib/theme';

	interface Props {
		city: CityStats;
		dates: string[];
	}
	let { city, dates }: Props = $props();

	// The pipeline's day classes (SUN_THRESHOLD=25 / CLOUD_THRESHOLD=70 in
	// aggregate.py). Sky palette: gold sun, white cloud.
	const GREY_AT = 70;
	function kind(e: number | null): 'clear' | 'grey' | 'mixed' | 'none' {
		if (e === null) return 'none';
		if (e < CLEAR_STARS) return 'clear';
		if (e >= GREY_AT) return 'grey';
		return 'mixed';
	}

	const CELL_CLASS = {
		clear: 'bg-sun-gold',
		grey: 'bg-white',
		mixed: 'bg-white/40',
		none: 'border border-dotted border-white/30'
	} as const;
</script>

<div class="ledger">
	<h4 class="m-0 mb-2 text-xs font-bold tracking-[0.12em] text-white uppercase text-shadow-sky">
		The sunshine ledger
	</h4>
	<!-- One square per day of the record, oldest first. -->
	<div class="flex max-w-[340px] flex-wrap gap-[3px]" aria-hidden="true">
		{#each dates as d, i (d)}
			<span
				class={['block h-[8px] w-[8px]', CELL_CLASS[kind(city.e[i])]]}
				title="{prettyDay(d)}{city.e[i] === null ? '' : ` · ${city.e[i]}%`}"
			></span>
		{/each}
	</div>
</div>
