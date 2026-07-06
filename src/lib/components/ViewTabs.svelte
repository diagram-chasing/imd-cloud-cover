<script lang="ts">
	import { sky } from '$lib/state/sky.svelte';
	import type { ViewMode } from '$lib/types';
	import { ToggleGroup, ToggleGroupItem } from '$lib/components/ui/toggle-group';

	const TABS: { id: ViewMode; label: string }[] = [
		{ id: 'today', label: 'TODAY' },
		{ id: 'week', label: 'WEEK' },
		{ id: 'month', label: 'MONTH' }
	];

	const itemClass =
		'rounded-none border-0 border-r-2 border-[var(--ink)] bg-[var(--paper)] px-3 text-[11px] tracking-wider text-[var(--ink)] [font-family:var(--font-display)] last:border-r-0 ' +
		'hover:bg-[var(--cloud-block)] hover:text-[var(--ink)] data-[state=on]:bg-[var(--ink)] data-[state=on]:text-[var(--paper)]';
</script>

<ToggleGroup
	type="single"
	value={sky.view}
	onValueChange={(v) => v && sky.setView(v as ViewMode)}
	class="rounded-none border-2 border-[var(--ink)]"
	aria-label="Time range"
>
	{#each TABS as tab (tab.id)}
		<ToggleGroupItem value={tab.id} class={itemClass}>{tab.label}</ToggleGroupItem>
	{/each}
</ToggleGroup>
