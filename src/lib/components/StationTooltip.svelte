<script lang="ts">
	import type { Station } from '$lib/types';
	import { fade } from 'svelte/transition';
	import { prettyDate, skyCondition, stationLabel, stationSubtitle } from '$lib/format';

	interface Props {
		station: Station | null;
		values: { h: number; m: number; l: number; r?: number } | null;
		clientX: number;
		clientY: number;
		members?: number;
		date?: string;
		when?: string;
	}

	let { station, values, clientX, clientY, members = 1, date, when }: Props = $props();

	let style = $derived.by(() => {
		const flipX = clientX > window.innerWidth - 230;
		const flipY = clientY > window.innerHeight - 190;
		const x = flipX ? clientX - 12 : clientX + 12;
		const y = flipY ? clientY - 12 : clientY + 12;
		return `left:${x}px; top:${y}px; transform: translate(${flipX ? '-100%' : '0'}, ${
			flipY ? '-100%' : '0'
		});`;
	});

	const ROWS: { key: 'h' | 'm' | 'l'; label: string }[] = [
		{ key: 'h', label: 'HIGH · CIRRUS' },
		{ key: 'm', label: 'MID · ALTO' },
		{ key: 'l', label: 'LOW · CUMULUS' }
	];
	const SEGS = 6;
	function filled(v: number): number {
		return Math.round((v / 100) * SEGS);
	}

	let summary = $derived(values ? skyCondition(values) : '');
</script>

{#if station && values}
	<div
		class="tooltip pointer-events-none fixed z-40 min-w-[210px] bg-paper px-2.5 py-2 text-ink shadow-[0_0_0_2px] shadow-ink"
		{style}
		role="tooltip"
		transition:fade={{ duration: 100 }}
	>
		<div class="m-0 flex items-center gap-2 text-base leading-tight tracking-[0.03em] uppercase">
			{stationLabel(station)}
			<span class="summary m-0 w-fit bg-day-sea px-1 py-0.5 text-xs tracking-wider text-paper"
				>{summary}</span
			>
		</div>
		{#if stationSubtitle(station)}<div class="state mt-0.5 text-xs opacity-70">
				{stationSubtitle(station)}
			</div>{/if}
		{#if when}<div class="when mt-[3px] text-xs">
				{[prettyDate(date), when].filter(Boolean).join(' · ')}
			</div>{/if}
		<div class="caption mt-1.5 mb-1 border-t border-border/60 pt-1 text-xs text-ink">
			% OF SKY COVERED, BY ALTITUDE
		</div>
		<div class="rows flex flex-col gap-[3px]">
			{#each ROWS as row (row.key)}
				<div class="row flex items-center gap-1.5">
					<span class="rlabel w-[104px] text-xs tracking-[0.03em] opacity-80">{row.label}</span>
					<span class="bar flex gap-px" aria-hidden="true">
						{#each Array(SEGS) as _, i (i)}
							<span
								class={[
									'seg h-2 w-[9px]',
									i < filled(values[row.key]) ? 'bg-day-sea' : 'bg-mist-300'
								]}
							></span>
						{/each}
					</span>
					<span class="num w-[26px] text-right text-xs">{values[row.key]}%</span>
				</div>
			{/each}
		</div>
	</div>
{/if}
