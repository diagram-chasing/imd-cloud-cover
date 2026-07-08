<script lang="ts">
	import type { Summary } from '$lib/types';
	import StreakBoard from '$lib/components/StreakBoard.svelte';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import { sky } from '$lib/state/sky.svelte';

	interface Props {
		summary: Summary;
		onselect?: (code: string) => void;
		/** Free sea-gutter width beside the landmass, screen px (from PixelMap.onlayout). */
		gutter: number;
		/** Current zoom as a multiple of the fit zoom. */
		zoomRatio: number;
	}
	let { summary, onselect, gutter, zoomRatio }: Props = $props();

	// Revealed by the STREAKS toggle in the bottom rail. Like the title cartouche,
	// the list only lives in the sea gutter: while zoomed in the land slides under
	// the gutter, so it fades out (and returns when the view zooms back out).
	const MIN_GUTTER = 220; // below this the gutter can't fit the list — hide
	let hasRoom = $derived(gutter >= MIN_GUTTER);
	let shown = $derived(sky.showStreaks && hasRoom && zoomRatio <= 1.2);
	let width = $derived(Math.max(200, Math.min(300, gutter - 32)));

	// Pixel scrollbar: a square current-colour thumb on a hairline track.
	const scrollbarClass =
		'w-2 p-0 border-l-0 [&_[data-slot=scroll-area-thumb]]:rounded-none [&_[data-slot=scroll-area-thumb]]:bg-current [&_[data-slot=scroll-area-thumb]]:opacity-60';
</script>

<!-- Transparent white-on-sky list in the sea gutter left of the landmass,
     mirroring the title cartouche on the right. No box — reads as part of the sky. -->
{#if hasRoom}
	<aside class="panel" class:shown style="width:{width}px" aria-label="Station streaks">
		<h2>STATION STREAKS</h2>
		<p class="caption">CONSECUTIVE CLEAR / OVERCAST DAYS</p>
		<div class="body">
			<ScrollArea class="h-full" scrollbarYClasses={scrollbarClass}>
				<StreakBoard {summary} {onselect} stacked limit={5} />
			</ScrollArea>
		</div>
	</aside>
{/if}

<style>
	/* Same voice as the title cartouche: white type straight on the sky with a
	   dark shadow for legibility, no background, no border. --ink flips the whole
	   StreakBoard's text to white. */
	.panel {
		--ink: #ffffff;
		position: absolute;
		top: 50%;
		left: 16px;
		transform: translateY(-50%) translateX(-8px);
		z-index: 10;
		color: #ffffff;
		text-shadow: 1px 1px 0 rgba(11, 29, 58, 0.9);
		padding: 10px 12px 12px;
		max-height: min(70%, 560px);
		display: flex;
		flex-direction: column;
		pointer-events: none;
		opacity: 0;
		visibility: hidden; /* keep it out of the a11y/tab order while hidden */
		transition:
			opacity 0.35s ease,
			transform 0.35s ease,
			visibility 0s linear 0.35s;
	}
	.panel.shown {
		opacity: 1;
		visibility: visible;
		transform: translateY(-50%) translateX(0);
		pointer-events: auto;
		transition:
			opacity 0.35s ease,
			transform 0.35s ease,
			visibility 0s;
	}
	h2 {
		margin: 0;
		font-family: var(--font-display);
		font-size: 12px;
		letter-spacing: 0.08em;
	}
	.caption {
		margin: 2px 0 8px;
		font-family: var(--font-display);
		font-size: 9px;
		letter-spacing: 0.06em;
		opacity: 0.75;
	}
	.body {
		flex: 1;
		min-height: 0;
	}
	/* Give the board text the same sky shadow, and a light hover wash that reads
	   on the sky rather than the dark tint used on a pale panel. */
	.body :global(li button) {
		text-shadow: 1px 1px 0 rgba(11, 29, 58, 0.9);
	}
	.body :global(li button:hover) {
		background: rgba(255, 255, 255, 0.14);
	}

	/* Phones never get the gutter list — the full-screen overlay takes over. */
	@media (max-width: 767px) {
		.panel {
			display: none;
		}
	}
</style>
