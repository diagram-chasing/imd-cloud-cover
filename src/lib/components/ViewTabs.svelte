<script lang="ts">
	import { sky } from '$lib/state/sky.svelte';
	import type { ViewMode } from '$lib/types';

	const TABS: { id: ViewMode; label: string }[] = [
		{ id: 'today', label: 'TODAY' },
		{ id: 'week', label: 'WEEK' },
		{ id: 'month', label: 'MONTH' }
	];
</script>

<div class="tabs" role="tablist" aria-label="Time range">
	{#each TABS as tab (tab.id)}
		<button
			class="tab"
			class:active={sky.view === tab.id}
			role="tab"
			aria-selected={sky.view === tab.id}
			onclick={() => sky.setView(tab.id)}
		>
			{tab.label}
		</button>
	{/each}
</div>

<style>
	.tabs {
		display: inline-flex;
		gap: 0;
		box-shadow: 0 0 0 2px var(--ink);
	}
	.tab {
		font-family: var(--font-display);
		font-size: 12px;
		letter-spacing: 0.05em;
		padding: 6px 12px;
		background: var(--paper);
		color: var(--ink);
		cursor: pointer;
		border-right: 2px solid var(--ink);
	}
	.tab:last-child {
		border-right: 0;
	}
	.tab.active {
		background: var(--ink);
		color: var(--ink-on-dark);
	}
	.tab:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
</style>
