<script lang="ts">
	// Two aligned "barcode" strips — one per city — where each vertical stripe is a
	// day and its brightness is that day's effective cloud cover (deep blue = clear,
	// solid white = overcast; a diagonal-hatched grey stripe = no reading). Stacking
	// the focused city over its sky twin makes the shared rhythm visible: the bright
	// and dark columns line up.
	import { coverTier } from '$lib/theme';
	import PixelButton from '$lib/components/PixelButton.svelte';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { ShuffleIcon } from '@hugeicons/core-free-icons';
	interface Props {
		/** Calendar dates, one per column (the rollup's `dates`). */
		dates: string[];
		aName: string;
		bName: string;
		/** Daily effective cover aligned to `dates`; null = no reading that day. */
		aE: (number | null)[];
		bE: (number | null)[];
		/** Jump to a new random city + twin. Hides the control when omitted. */
		onShuffle?: () => void;
	}
	let { dates, aName, bName, aE, bE, onShuffle }: Props = $props();

	// Quantize present-day cover into the map's four cloud tiers so the strip reads
	// as chunky bands rather than a smooth gradient. Tier 0 (clear) draws nothing —
	// the deep-blue track shows through.
	const TIER_OPACITY = [0, 0.32, 0.56, 0.8, 1];
	const TRACK = '#164a7c';
	const HATCH = 'repeating-linear-gradient(45deg, #2b3a4d 0 3px, #55637b 3px 6px)';

	const ROW_H = 26; // px — tall enough to read clearly
	let w = $state(0); // measured strip width in px

	const N = $derived(dates.length);
	const bw = $derived(N ? w / N : 0);
	// Integer left edge per column so crisp bars tile with no sub-pixel seams.
	const edge = (i: number) => Math.round(i * bw);

	let rows = $derived([
		{ id: 'a', name: aName, e: aE },
		{ id: 'b', name: bName, e: bE }
	]);
</script>

<figure class="relative m-0 bg-day-sea p-4 text-white shadow-[4px_4px_0_rgba(11,29,58,0.4)] sm:p-6">
	{#if onShuffle}
		<div class="absolute top-3 right-3 sm:top-5 sm:right-5">
			<PixelButton onclick={onShuffle} size="xs" flat cap="gold" aria-label="Shuffle">
				<HugeiconsIcon icon={ShuffleIcon} size={14} strokeWidth={2.5} />
			</PixelButton>
		</div>
	{/if}

	<!-- Legend centered up top: two chunky pixel chips reading clear → overcast. -->
	<div
		class="mb-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm font-bold tracking-wide uppercase"
	>
		<span class="pixel-chip" style="background:{TRACK}">Clear</span>
		<span aria-hidden="true" class="opacity-70">→</span>
		<span class="pixel-chip text-navy" style="background:#ffffff">Overcast</span>
	</div>

	<div class="grid grid-cols-[minmax(0,7rem)_1fr] items-center gap-x-4 gap-y-2.5">
		{#each rows as row (row.id)}
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
		{/each}
	</div>

	<!-- No-reading key, centered beneath the strips. -->
	<div class="mt-4 flex items-center justify-center gap-2 text-sm opacity-90">
		<span class="pixel-swatch" style="background:{HATCH}" aria-hidden="true"></span>
		No reading
	</div>

	<p class="sr-only">
		Two barcode strips, one stripe per day, aligned by date. Deep-blue stripes are clear days, white
		stripes are overcast days, and hatched grey stripes are days with no reading. The top strip is {aName};
		the bottom is its sky twin {bName}. Their bright and dark columns tend to line up, showing the
		two skies clear and cloud over on the same days.
	</p>
</figure>

<style>
	/* Chunky pixel corners echoing PixelButton's bevel — cut in 2px steps so the
		swatches read as low-res chips rather than plain rectangles. */
	.pixel-chip,
	.pixel-swatch {
		clip-path: polygon(
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
	}
	.pixel-chip {
		padding: 0.15em 0.6em;
	}
	.pixel-swatch {
		display: inline-block;
		width: 1rem;
		height: 1rem;
	}
</style>
