<script lang="ts">
	import { base } from '$app/paths';
	import type { Station, Forecast } from '$lib/types';
	import { fetchForecast } from '$lib/api/r2';
	import { prettyDate, skyCondition } from '$lib/format';
	import StationMeteogram from './StationMeteogram.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { Cancel01Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons';

	interface Props {
		code: string;
		station: Station;
		current: { h: number; m: number; l: number } | null;
		date: string;
		when: string;
		onclose?: () => void;
	}
	let { code, station, current, date, when, onclose }: Props = $props();

	let forecast = $state<Forecast | null>(null);
	let forecastError = $state(false);

	$effect(() => {
		forecast = null;
		forecastError = false;
		const c = code;
		fetchForecast(date, c)
			.then((f) => {
				if (c === code) forecast = f;
			})
			.catch(() => {
				if (c === code) forecastError = true;
			});
	});

	const ROWS: { key: 'h' | 'm' | 'l'; label: string }[] = [
		{ key: 'h', label: 'HIGH · CIRRUS' },
		{ key: 'm', label: 'MID · ALTO' },
		{ key: 'l', label: 'LOW · CUMULUS' }
	];
	function filled(v: number): number {
		return Math.round(v / 10);
	}

	let summary = $derived(current ? skyCondition(current) : 'NO READING TODAY');
</script>

<div class="card flex w-full flex-col gap-3 text-ink">
	<header class="flex items-start justify-between gap-2.5">
		<div class="title">
			<h2 class="m-0 flex items-center gap-2 text-base leading-tight tracking-[0.03em] uppercase">
				{station.name}
				<span class="summary m-0 w-fit bg-day-sea px-1 py-0.5 text-xs tracking-wider text-paper"
					>{summary}</span
				>
			</h2>
			{#if station.state}<p class="state m-0 mt-0.5 text-xs opacity-70">{station.state}</p>{/if}
			<p class="when m-0 mt-[3px] text-xs tracking-wider opacity-60">
				{prettyDate(date)} · {when}
			</p>
		</div>
		<div class="head-right flex shrink-0 items-center gap-2">
			{#if onclose}
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Close"
					class="close"
					onclick={() => onclose?.()}
				>
					<HugeiconsIcon icon={Cancel01Icon} size={15} strokeWidth={2.5} aria-hidden="true" />
				</Button>
			{/if}
		</div>
	</header>

	<section class="readout flex flex-col gap-2">
		{#if current}
			<div class="bands flex flex-col gap-[3px]" aria-label="Percent of sky covered, by altitude">
				<p class="caption m-0 mb-[3px] border-t border-border pt-2 text-xs">
					% OF SKY COVERED <span class="now bg-sun-gold px-[3px] py-px font-bold text-ink"
						>{when}</span
					>, BY ALTITUDE
				</p>
				{#each ROWS as row (row.key)}
					<div class="band-row flex items-center gap-2">
						<span class="blabel w-[104px] text-xs tracking-[0.03em] opacity-80">{row.label}</span>
						<span class="bar flex flex-1 gap-px" aria-hidden="true">
							{#each Array(10) as _, i (i)}
								<span
									class={[
										'seg h-2 flex-1',
										i < filled(current[row.key]) ? 'bg-day-sea' : 'bg-mist-300'
									]}
								></span>
							{/each}
						</span>
						<span class="num w-[38px] text-right text-xs">{current[row.key]}%</span>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<figure class="meteogram m-0">
		{#if forecastError}
			<p class="note py-6 text-center text-sm opacity-70">Forecast chart unavailable.</p>
		{:else}
			<StationMeteogram {forecast} today={date} />
		{/if}
	</figure>

	<footer class="cta mt-0.5">
		<Button
			variant="default"
			size="sm"
			href="{base}/station/{code}"
			class="more w-full bg-ink tracking-[0.06em] text-paper uppercase hover:bg-focus hover:text-ink"
		>
			<span class="flex items-center justify-center gap-1.5">
				More details
				<HugeiconsIcon icon={ArrowRight01Icon} size={14} strokeWidth={2.5} aria-hidden="true" />
			</span>
		</Button>
	</footer>
</div>

<style>
	.meteogram :global(canvas) {
		width: 100%;
		max-width: none;
	}
</style>
