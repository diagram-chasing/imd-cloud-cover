<script lang="ts">
	import { base } from '$app/paths';
	import type { Station, Forecast } from '$lib/types';
	import { fetchForecast } from '$lib/api/r2';
	import { prettyDate, skyCondition, stationLabel, stationSubtitle } from '$lib/format';
	import { sky } from '$lib/state/sky.svelte';
	import { webcamFor } from '$lib/webcams';
	import StationMeteogram from './StationMeteogram.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import {
		Cancel01Icon,
		ArrowRight01Icon,
		CctvCameraIcon,
		ArrowUpRight01Icon
	} from '@hugeicons/core-free-icons';

	interface Props {
		code: string;
		station: Station;
		current: { h: number; m: number; l: number } | null;
		date: string;
		/** Date the forecast files are keyed under (the data/scrape date). Falls back to
		 *  `date`, but when IMD's daily refresh is late these diverge: `date` follows the
		 *  active display day while the baked forecast still lives under the data date. */
		metDate?: string;
		when: string;
		onclose?: () => void;
	}
	let { code, station, current, date, metDate, when, onclose }: Props = $props();

	let forecast = $state<Forecast | null>(null);
	let forecastError = $state(false);

	$effect(() => {
		forecast = null;
		forecastError = false;
		const c = code;
		fetchForecast(metDate ?? date, c)
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

	// Mirror the map's band focus here: when an altitude band is picked in the toggle,
	// emphasise its row and ghost the rest instead of showing an identical "all" readout.
	const BAND_TO_ROW = { high: 'h', middle: 'm', low: 'l' } as const;
	let focusKey = $derived(sky.focusBand ? BAND_TO_ROW[sky.focusBand] : null);

	let summary = $derived(current ? skyCondition(current) : 'NO READING TODAY');
	let webcam = $derived(webcamFor(code));
</script>

<div class="card flex w-full flex-col gap-3 text-ink">
	<header class="flex items-start justify-between gap-2.5">
		<div class="title">
			<h2 class="m-0 flex items-center gap-2 text-base leading-tight tracking-[0.03em] uppercase">
				{stationLabel(station)}
				<span class="summary m-0 w-fit bg-day-sea px-1 py-0.5 text-xs tracking-wider text-paper"
					>{summary}</span
				>
			</h2>
			{#if stationSubtitle(station)}<p class="state m-0 mt-0.5 text-xs opacity-70">
					{stationSubtitle(station)}
				</p>{/if}
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
					% OF SKY COVERED AT <span class="now bg-sun-gold px-[3px] py-px font-bold text-ink"
						>{when}</span
					>, BY ALTITUDE
				</p>
				{#each ROWS as row (row.key)}
					{@const focused = focusKey === row.key}
					{@const ghosted = focusKey !== null && !focused}
					<div
						class={[
							'band-row -mx-1 flex items-center gap-2 rounded-sm px-1 transition-opacity duration-150',
							focused && 'bg-sun-gold/20',
							ghosted && 'opacity-40'
						]}
					>
						<span
							class={[
								'blabel w-[104px] text-xs tracking-[0.03em]',
								focused ? 'font-bold opacity-100' : 'opacity-80'
							]}>{row.label}</span
						>
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
						<span class={['num w-[38px] text-right text-xs', focused && 'font-bold']}
							>{current[row.key]}%</span
						>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<figure class="meteogram m-0">
		<!-- Explicitly time-framed so this isn't mistaken for a second % breakdown: the
		     chart above reads left→right as percentage, this one reads left→right as days. -->
		<figcaption class="caption m-0 mb-[3px] border-t border-border pt-2 text-xs">
			CLOUD COVER · NEXT 10 DAYS, 3-HOURLY
		</figcaption>
		{#if forecastError}
			<p class="note py-6 text-center text-sm opacity-70">Forecast chart unavailable.</p>
		{:else}
			<StationMeteogram {forecast} today={date} />
		{/if}
	</figure>

	{#if webcam}
		<a
			class="webcam -mx-0.5 flex items-center gap-2 border-t border-border px-0.5 pt-2 text-xs text-ink uppercase no-underline hover:text-focus"
			href={webcam.url}
			target="_blank"
			rel="noopener noreferrer"
		>
			<HugeiconsIcon icon={CctvCameraIcon} size={15} strokeWidth={2} aria-hidden="true" />
			<span>Live webcam</span>
			<HugeiconsIcon icon={ArrowUpRight01Icon} size={13} strokeWidth={2.5} aria-hidden="true" />
		</a>
	{/if}

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
