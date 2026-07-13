<script lang="ts">
	// barcode: one column per day, brightness = cloud cover. pass bName/bE for twin comparison
	import { coverTier } from '$lib/theme';
	import PixelButton from '$lib/components/PixelButton.svelte';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { ShuffleIcon } from '@hugeicons/core-free-icons';
	interface Props {
		/** Calendar dates, one per column (the rollup's `dates`). */
		dates: string[];
		aName: string;
		/** Daily effective cover aligned to `dates`; null = no reading that day. */
		aE: (number | null)[];
		/** Optional second (sky-twin) strip. Both omitted = single-city strip. */
		bName?: string;
		bE?: (number | null)[];
		/** Draw a month time axis beneath the strips. */
		axis?: boolean;
		/** Jump to a new random city + twin. Hides the control when omitted. */
		onShuffle?: () => void;
	}
	let { dates, aName, aE, bName, bE, axis = false, onShuffle }: Props = $props();

	// quantize into 4 tiers; tier 0 (clear) draws nothing, track shows through
	const TIER_OPACITY = [0, 0.32, 0.56, 0.8, 1];
	const TRACK = '#164a7c';
	const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

	const ROW_H = 26;
	const AXIS_H = 18; // px — tick + month label
	let w = $state(0);

	const N = $derived(dates.length);
	const bw = $derived(N ? w / N : 0);
	// integer left edge so crisp bars tile with no sub-pixel seams
	const edge = (i: number) => Math.round(i * bw);

	let rows = $derived(
		bName != null && bE
			? [
					{ id: 'a', name: aName, e: aE },
					{ id: 'b', name: bName, e: bE }
				]
			: [{ id: 'a', name: aName, e: aE }]
	);

	// first column of each month gets a tick + label
	let ticks = $derived.by(() => {
		const out: { i: number; label: string }[] = [];
		let lastMonth = -1;
		for (let i = 0; i < dates.length; i++) {
			const m = new Date(dates[i]).getMonth();
			if (m !== lastMonth) {
				lastMonth = m;
				out.push({ i, label: MONTHS[m] });
			}
		}
		return out;
	});
</script>

<figure class="relative m-0 bg-day-sea p-4 text-white shadow-[4px_4px_0_rgba(11,29,58,0.4)] sm:p-6">
	{#if onShuffle}
		<div class="absolute top-3 right-3 sm:top-5 sm:right-5">
			<PixelButton onclick={onShuffle} size="xs" flat cap="gold" aria-label="Shuffle">
				<HugeiconsIcon icon={ShuffleIcon} size={14} strokeWidth={2.5} />
			</PixelButton>
		</div>
	{/if}

	<div
		class="mb-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm font-bold tracking-wide uppercase"
	>
		<span class="pixel-chip" style="background:{TRACK}">Clear</span>
		<span aria-hidden="true" class="opacity-70">→</span>
		<span class="pixel-chip text-navy" style="background:#ffffff">Overcast</span>
	</div>

	<div class="flex flex-col gap-y-3 sm:grid sm:grid-cols-[minmax(0,7rem)_1fr] sm:items-center sm:gap-x-4 sm:gap-y-2.5">
		{#each rows as row (row.id)}
			<!-- Label stacks above the strip on mobile so the chart gets full width; the
				sm grid places it back beside the strip. `contents` lets both children join
				the parent grid directly at sm. -->
			<div class="flex flex-col gap-y-1 sm:contents">
				<span class="truncate text-sm font-bold tracking-wide uppercase sm:text-base">
					{row.name}
				</span>
				<div class="w-full" bind:clientWidth={w}>
				<svg
					width={w}
					height={ROW_H}
					viewBox="0 0 {w} {ROW_H}"
					class="block [shape-rendering:crispEdges]"
					aria-hidden="true"
				>
					<defs>
						<pattern
							id="nd-{row.id}"
							width="7"
							height="7"
							patternUnits="userSpaceOnUse"
							patternTransform="rotate(45)"
						>
							<rect width="7" height="7" fill="#2b3a4d" />
							<rect width="3.5" height="7" fill="#55637b" />
						</pattern>
					</defs>
					<rect x="0" y="0" width={w} height={ROW_H} fill={TRACK} />
					{#each row.e as v, i (i)}
						{#if v == null}
							<rect
								x={edge(i)}
								y="0"
								width={edge(i + 1) - edge(i)}
								height={ROW_H}
								fill="url(#nd-{row.id})"
							/>
						{:else if coverTier(v) > 0}
							<rect
								x={edge(i)}
								y="0"
								width={edge(i + 1) - edge(i)}
								height={ROW_H}
								fill="#ffffff"
								opacity={TIER_OPACITY[coverTier(v)]}
							/>
						{/if}
					{/each}
				</svg>
				</div>
			</div>
		{/each}

		{#if axis}
			<!-- Empty label cell keeps the axis aligned under the strips (sm+ only;
				on mobile there's no side label column to offset). -->
			<span aria-hidden="true" class="hidden sm:block"></span>
			<svg
				width={w}
				height={AXIS_H}
				viewBox="0 0 {w} {AXIS_H}"
				class="block [shape-rendering:crispEdges]"
				aria-hidden="true"
			>
				{#each ticks as t (t.i)}
					<line x1={edge(t.i)} y1="0" x2={edge(t.i)} y2="4" stroke="#ffffff" stroke-opacity="0.5" />
					<text
						x={edge(t.i) + 3}
						y="13"
						fill="#ffffff"
						fill-opacity="0.75"
						class="text-[10px] font-bold tracking-wide [shape-rendering:auto]"
					>
						{t.label}
					</text>
				{/each}
			</svg>
		{/if}
	</div>

	<div class="mt-4 flex items-center justify-center gap-2 text-sm opacity-90">
		<span class="pixel-swatch" aria-hidden="true"></span>
		No reading
	</div>

	<p class="sr-only">
		{#if bName != null && bE}
			Two barcode strips, one stripe per day, aligned by date. Deep-blue stripes are clear days,
			white stripes are overcast days, and hatched grey stripes are days with no reading. The top
			strip is {aName}; the bottom is its sky twin {bName}. Their bright and dark columns tend to
			line up, showing the two skies clear and cloud over on the same days.
		{:else}
			A barcode strip for {aName}, one stripe per day. Deep-blue stripes are clear days, white
			stripes are overcast days, and hatched grey stripes are days with no reading.
		{/if}
	</p>
</figure>

<style>
	.pixel-chip,
	.pixel-swatch {
		--pixel-clip: polygon(
			0 4px,
			2px 4px,
			2px 2px,
			4px 2px,
			4px 0,
			calc(100% - 4px) 0,
			calc(100% - 4px) 2px,
			calc(100% - 2px) 2px,
			calc(100% - 2px) 4px,
			100% 4px,
			100% calc(100% - 4px),
			calc(100% - 2px) calc(100% - 4px),
			calc(100% - 2px) calc(100% - 2px),
			calc(100% - 4px) calc(100% - 2px),
			calc(100% - 4px) 100%,
			4px 100%,
			4px calc(100% - 2px),
			2px calc(100% - 2px),
			2px calc(100% - 4px),
			0 calc(100% - 4px)
		);
		clip-path: var(--pixel-clip);
	}
	.pixel-chip {
		padding: 0.15em 0.6em;
	}
	/* The swatch element is the white outline; the hatch sits on top via ::before,
		inset 1px, so a 1px white ring shows on every edge and notched corner. A plain
		border can't do this — it gets sliced off at the clip-path notches. */
	.pixel-swatch {
		position: relative;
		display: inline-block;
		width: 1rem;
		height: 1rem;
		background: rgba(255, 255, 255, 0.65);
	}
	.pixel-swatch::before {
		content: '';
		position: absolute;
		inset: 1px;
		background: repeating-linear-gradient(45deg, #2b3a4d 0 3px, #55637b 3px 6px);
		clip-path: var(--pixel-clip);
	}
</style>
