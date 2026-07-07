<script lang="ts">
	import type { Summary } from '$lib/types';
	import StreakBoard from '$lib/components/StreakBoard.svelte';

	interface Props {
		summary: Summary;
		onselect?: (code: string) => void;
		/** Free sea-gutter width beside the landmass, screen px (from PixelMap.onlayout). */
		gutter: number;
		/** Current zoom as a multiple of the fit zoom. */
		zoomRatio: number;
	}
	let { summary, onselect, gutter, zoomRatio }: Props = $props();

	// Collapsed by default — the vertical STREAKS tab is the persistent affordance.
	// While zoomed in, the land slides under the gutter, so an open panel folds
	// back to its tab and returns when the view zooms out (the choice is kept).
	let open = $state(false);
	const MIN_GUTTER = 220; // below this the gutter can't fit the inset — hide all
	let hasRoom = $derived(gutter >= MIN_GUTTER);
	let expanded = $derived(open && hasRoom && zoomRatio <= 1.2);
	let width = $derived(Math.max(200, Math.min(300, gutter - 32)));
</script>

<!-- Nautical-chart inset table in the sea gutter right of the landmass,
     mirroring the title cartouche on the left. -->
{#if hasRoom}
	{#if expanded}
		<aside class="panel" style="width:{width}px" aria-label="Station streaks">
			<header>
				<h2>STATION STREAKS</h2>
				<button class="fold" aria-expanded="true" aria-label="Collapse streaks" onclick={() => (open = false)}
					>−</button
				>
			</header>
			<p class="caption">CONSECUTIVE CLEAR / OVERCAST DAYS</p>
			<div class="body">
				<StreakBoard {summary} {onselect} stacked limit={5} />
			</div>
		</aside>
	{:else}
		<button class="tab" aria-expanded="false" onclick={() => (open = true)}>STREAKS ▸</button>
	{/if}
{/if}

<style>
	.panel {
		position: absolute;
		top: 50%;
		right: 16px;
		transform: translateY(-50%);
		z-index: 10;
		background: var(--paper);
		color: var(--ink);
		border: 2px solid var(--ink);
		box-shadow: 4px 4px 0 0 var(--ink);
		padding: 10px 12px 12px;
		max-height: min(70%, 560px);
		display: flex;
		flex-direction: column;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	h2 {
		margin: 0;
		font-family: var(--font-display);
		font-size: 12px;
		letter-spacing: 0.08em;
	}
	.fold {
		width: 24px;
		height: 24px;
		flex: 0 0 auto;
		border: 2px solid var(--ink);
		background: var(--paper);
		color: var(--ink);
		font-family: var(--font-display);
		font-size: 14px;
		line-height: 1;
		cursor: pointer;
	}
	.fold:hover {
		background: var(--cloud-block);
	}
	.caption {
		margin: 2px 0 8px;
		font-family: var(--font-display);
		font-size: 9px;
		letter-spacing: 0.06em;
		opacity: 0.6;
	}
	.body {
		overflow-y: auto;
		min-height: 0;
	}

	/* Collapsed affordance: a vertical tab riding the map frame's right edge. */
	.tab {
		position: absolute;
		top: 50%;
		right: 0;
		transform: translateY(-50%);
		z-index: 10;
		writing-mode: vertical-rl;
		padding: 10px 4px;
		border: 2px solid var(--ink);
		border-right: 0;
		background: var(--paper);
		color: var(--ink);
		font-family: var(--font-display);
		font-size: 10px;
		letter-spacing: 0.1em;
		cursor: pointer;
	}
	.tab:hover {
		background: var(--cloud-block);
	}
	.tab:focus-visible,
	.fold:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}

	/* Phones never get the gutter inset — the STREAKS chip + drawer takes over. */
	@media (max-width: 767px) {
		.panel,
		.tab {
			display: none;
		}
	}
</style>
