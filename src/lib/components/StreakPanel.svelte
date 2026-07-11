<script lang="ts">
	import type { Summary } from '$lib/types';
	import StreakBoard from '$lib/components/StreakBoard.svelte';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import { sky } from '$lib/state/sky.svelte';

	interface Props {
		summary: Summary;
		onselect?: (code: string) => void;
		gutter: number;
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
     mirroring the title cartouche on the right. No box — reads as part of the sky.
     Same voice as the title cartouche: white type straight on the sky with a dark
     shadow for legibility, no background, no border. --ink flips the whole
     StreakBoard's text to white. Phones never get the gutter list (max-md:hidden) —
     the full-screen overlay takes over. -->
{#if hasRoom}
	<!-- visibility keeps it out of the a11y/tab order while hidden; the 0.35s delay
	     on hide (vs 0s on show) lets the fade finish before it leaves the tree. -->
	<aside
		class={[
			'panel absolute top-1/2 left-4 z-10 flex max-h-[min(70%,560px)] flex-col [padding:10px_12px_12px] text-white [--ink:var(--color-ink-on-dark)] text-shadow-sky max-md:hidden',
			shown
				? 'pointer-events-auto visible translate-x-0 -translate-y-1/2 opacity-100 [transition:opacity_0.35s_ease,transform_0.35s_ease,visibility_0s]'
				: 'pointer-events-none invisible -translate-x-2 -translate-y-1/2 opacity-0 [transition:opacity_0.35s_ease,transform_0.35s_ease,visibility_0s_linear_0.35s]'
		]}
		style="width:{width}px"
		aria-label="Station streaks"
	>
		<h2 class="m-0 text-xs tracking-[0.08em]">STATION STREAKS</h2>
		<p class="mt-0.5 mb-2 text-xs tracking-[0.06em] opacity-75">
			CONSECUTIVE CLEAR / OVERCAST DAYS
		</p>
		<div class="body min-h-0 flex-1">
			<ScrollArea class="h-full" scrollbarYClasses={scrollbarClass}>
				<StreakBoard {summary} {onselect} stacked limit={5} />
			</ScrollArea>
		</div>
	</aside>
{/if}

<style>
	/* Bridge rules for the StreakBoard's internals: give its buttons the same sky
	   shadow, and a light hover wash that reads on the sky rather than the dark tint
	   used on a pale panel. Token vars only — no literals. */
	.body :global(li button) {
		text-shadow: 1px 1px 0 color-mix(in srgb, var(--color-navy) 90%, transparent);
	}
	.body :global(li button:hover) {
		background: color-mix(in srgb, var(--color-white) 14%, transparent);
	}
</style>
