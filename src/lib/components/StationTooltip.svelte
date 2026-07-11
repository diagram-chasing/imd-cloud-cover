<script lang="ts">
	import type { Station } from '$lib/types';
	import { prettyDate } from '$lib/format';
	import { skyCondition } from '$lib/summary';

	interface Props {
		station: Station | null;
		values: { h: number; m: number; l: number } | null;
		clientX: number;
		clientY: number;
		members?: number;
		date?: string;
		when?: string;
	}

	let { station, values, clientX, clientY, members = 1, date, when }: Props = $props();

	// Flip near the right/bottom edges of the viewport.
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
	function filled(v: number): number {
		return Math.round(v / 10);
	}

	let summary = $derived(values ? skyCondition(values) : '');
</script>

{#if station && values}
	<div
		class="tooltip pointer-events-none fixed z-40 min-w-[190px] bg-paper px-2.5 py-2 text-ink shadow-[0_0_0_2px] shadow-ink"
		{style}
		role="tooltip"
	>
		<div class="name text-xs leading-relaxed tracking-wider uppercase">{station.name}</div>
		{#if station.state}<div class="state text-xs opacity-70">{station.state}</div>{/if}
		{#if when}<div class="when mt-[3px] text-xs tracking-wider opacity-55">
				{[prettyDate(date), when].filter(Boolean).join(' · ')}
			</div>{/if}
		<div class="summary mt-1 text-xs leading-relaxed tracking-wider">{summary}</div>
		<div class="caption mt-1.5 mb-1 text-xs leading-relaxed tracking-wider opacity-55">
			% OF SKY COVERED, BY ALTITUDE
		</div>
		<div class="rows flex flex-col gap-[3px]">
			{#each ROWS as row (row.key)}
				<div class="row flex items-center gap-1.5">
					<span class="rlabel w-[74px] text-xs tracking-[0.03em]">{row.label}</span>
					<span class="bar flex gap-px" aria-hidden="true">
						{#each Array(6) as _, i (i)}
							<span
								class={[
									'seg h-2 w-[9px]',
									i < filled(values[row.key]) ? 'bg-accent' : 'bg-cloud-block'
								]}
							></span>
						{/each}
					</span>
					<span class="num w-[22px] text-right text-xs">{values[row.key]}</span>
				</div>
			{/each}
		</div>
		{#if members > 1}
			<div class="agg mt-1.5 text-xs leading-relaxed tracking-wider text-accent">
				◆ MEAN OF {members} STATIONS — ZOOM TO SPLIT
			</div>
			<div class="hint mt-1 text-xs leading-relaxed tracking-wider opacity-60">
				CLICK FOR NEAREST: {station.name} →
			</div>
		{:else}
			<div class="hint mt-1 text-xs leading-relaxed tracking-wider opacity-60">
				CLICK FOR STATION DETAIL →
			</div>
		{/if}
	</div>
{/if}
