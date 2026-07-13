<script lang="ts">
	// today card: same sky-condition read and altitude bars as StationTooltip
	import { prettyDate, skyCondition } from '$lib/format';

	interface Props {
		/** {h,m,l} cover at the current step, or null if no reading arrived. */
		values: { h: number; m: number; l: number } | null;
		stationName: string;
		/** Distance from the city centre to the reading station (km). */
		km?: number | null;
		date?: string;
		when?: string;
		/** Hero-scale variant: larger, more prominent, higher-resolution bars. */
		expanded?: boolean;
	}
	let { values, stationName, km, date, when, expanded = false }: Props = $props();

	const ROWS: { key: 'h' | 'm' | 'l'; label: string }[] = [
		{ key: 'h', label: 'HIGH · CIRRUS' },
		{ key: 'm', label: 'MID · ALTO' },
		{ key: 'l', label: 'LOW · CUMULUS' }
	];
	// expanded: 10 blocks so each = 10%; compact: 6
	const segCount = expanded ? 10 : 6;
	const filled = (v: number) => Math.min(segCount, Math.round(v / 10));

	let summary = $derived(values ? skyCondition(values) : '');
</script>

<div
	class={[
		'today flex h-full flex-col justify-between bg-paper text-ink shadow-[0_0_0_2px] shadow-ink',
		expanded ? 'gap-8 p-6' : 'gap-6 p-4'
	]}
>
	<div class="head">
		{#if when}
			<div
				class={['when tracking-wider uppercase opacity-55', expanded ? 'text-sm' : 'text-xs']}
			>
				{[prettyDate(date), when].filter(Boolean).join(' · ')}
			</div>
		{/if}
		<p
			class={[
				'summary mt-1 leading-tight tracking-wide',
				expanded ? 'text-[clamp(1.4rem,3.4vw,1.75rem)]' : 'text-[20px]'
			]}
		>
			{summary || 'NO READING'}
		</p>
	</div>

	<div class={['rows flex flex-col', expanded ? 'gap-5' : 'gap-3']}>
		{#each ROWS as row (row.key)}
			<div class={['row flex items-center', expanded ? 'gap-3.5' : 'gap-2.5']}>
				<span
					class={[
						'rlabel tracking-[0.03em]',
						expanded ? 'w-[104px] text-sm' : 'w-[88px] text-xs'
					]}>{row.label}</span
				>
				<span class={['bar flex flex-1', expanded ? 'gap-0.5' : 'gap-px']} aria-hidden="true">
					{#each Array(segCount) as _, i (i)}
						<span
							class={[
								'seg',
								expanded ? 'h-5 flex-1' : 'h-3 w-3.5',
								values && i < filled(values[row.key]) ? 'bg-day-sea' : 'bg-cloud-block'
							]}
						></span>
					{/each}
				</span>
				<span
					class={[
						'num text-right tabular-nums',
						expanded ? 'w-9 text-sm' : 'w-[26px] text-xs'
					]}>{values ? values[row.key] : '–'}</span
				>
			</div>
		{/each}
	</div>

	<p
		class={['cap tracking-[0.05em] opacity-60', expanded ? 'text-[11px]' : 'text-[10px]']}
	>
		READING FROM {stationName.toUpperCase()}{#if km != null} · {km} KM AWAY{/if}
	</p>
</div>
