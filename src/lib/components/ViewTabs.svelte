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
<nav class="views flex items-baseline gap-[7px]" aria-label="Time range">
	{#each TABS as tab, i (tab.id)}
		{#if i > 0}<span class="sep text-xs text-white/40 text-shadow-sky" aria-hidden="true">·</span
			>{/if}
		<button
			class={[
				'view cursor-pointer p-0 text-xs tracking-[0.08em] text-white text-shadow-sky hover:opacity-90',
				sky.view === tab.id
					? 'underline decoration-2 underline-offset-[3px] opacity-100'
					: 'opacity-55'
			]}
			aria-pressed={sky.view === tab.id}
			onclick={() => sky.setView(tab.id)}
		>
			{tab.label}
		</button>
	{/each}
</nav>
