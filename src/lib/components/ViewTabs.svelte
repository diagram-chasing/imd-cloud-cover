<script lang="ts">
	import { sky } from '$lib/state/sky.svelte';
	import type { ViewMode } from '$lib/types';

	const TABS: { id: ViewMode; label: string }[] = [
		{ id: 'today', label: 'TODAY' },
		{ id: 'week', label: 'WEEK' },
		{ id: 'month', label: 'MONTH' }
	];
</script>

<!-- Quiet text switcher: the active range is bright + underlined, the others
     recede. Reads as a chart annotation, not a button row. -->
<nav class="views" aria-label="Time range">
	{#each TABS as tab, i (tab.id)}
		{#if i > 0}<span class="sep" aria-hidden="true">·</span>{/if}
		<button
			class="view"
			class:on={sky.view === tab.id}
			aria-pressed={sky.view === tab.id}
			onclick={() => sky.setView(tab.id)}
		>
			{tab.label}
		</button>
	{/each}
</nav>

<style>
	.views {
		display: flex;
		align-items: baseline;
		gap: 7px;
		font-family: var(--font-display);
	}
	.view {
		padding: 0;
		font-size: 11px;
		letter-spacing: 0.08em;
		color: #fff;
		opacity: 0.55;
		cursor: pointer;
		text-shadow: 1px 1px 0 rgba(11, 29, 58, 0.9);
	}
	.view:hover {
		opacity: 0.9;
	}
	.view.on {
		opacity: 1;
		text-decoration: underline;
		text-underline-offset: 3px;
		text-decoration-thickness: 2px;
	}
	.sep {
		color: #fff;
		opacity: 0.4;
		font-size: 11px;
		text-shadow: 1px 1px 0 rgba(11, 29, 58, 0.9);
	}
	.view:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
</style>
