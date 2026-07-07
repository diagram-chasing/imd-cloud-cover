<script lang="ts">
	import { sky } from '$lib/state/sky.svelte';
	import type { ViewMode } from '$lib/types';
	import { ToggleGroup, ToggleGroupItem } from '$lib/components/ui/toggle-group';
	import { Popover, PopoverContent, PopoverTrigger } from '$lib/components/ui/popover';
	import { Button } from '$lib/components/ui/button';

	interface Props {
		/** Collapse the three tabs into one chip that opens a picker (mobile). */
		compact?: boolean;
	}
	let { compact = false }: Props = $props();

	const TABS: { id: ViewMode; label: string }[] = [
		{ id: 'today', label: 'TODAY' },
		{ id: 'week', label: 'WEEK' },
		{ id: 'month', label: 'MONTH' }
	];

	let open = $state(false);
	let currentLabel = $derived(TABS.find((t) => t.id === sky.view)?.label ?? 'TODAY');

	function pick(v: string) {
		if (!v) return;
		sky.setView(v as ViewMode);
		open = false;
	}

	const itemClass =
		'h-10 rounded-none border-0 border-r-2 border-[var(--ink)] bg-[var(--paper)] px-3 text-[11px] tracking-wider text-[var(--ink)] [font-family:var(--font-display)] last:border-r-0 ' +
		'hover:bg-[var(--cloud-block)] hover:text-[var(--ink)] data-[state=on]:bg-[var(--ink)] data-[state=on]:text-[var(--paper)]';
	const menuItemClass =
		'h-10 w-full justify-start rounded-none border-0 border-b-2 border-[var(--ink)] bg-[var(--paper)] px-3 text-[11px] tracking-wider text-[var(--ink)] [font-family:var(--font-display)] last:border-b-0 ' +
		'hover:bg-[var(--cloud-block)] hover:text-[var(--ink)] data-[state=on]:bg-[var(--ink)] data-[state=on]:text-[var(--paper)]';
</script>

{#if compact}
	<Popover bind:open>
		<PopoverTrigger>
			{#snippet child({ props })}
				<Button
					{...props}
					variant="outline"
					class="h-11 rounded-none border-2 border-[var(--ink)] bg-[var(--paper)] px-2.5 text-[11px] tracking-wider text-[var(--ink)] shadow-none [font-family:var(--font-display)] hover:bg-[var(--cloud-block)] hover:text-[var(--ink)]"
					aria-label="Time range"
				>
					{currentLabel} ▾
				</Button>
			{/snippet}
		</PopoverTrigger>
		<PopoverContent
			side="top"
			align="end"
			sideOffset={6}
			collisionPadding={12}
			class="w-auto rounded-none border-2 border-[var(--ink)] bg-[var(--paper)] p-0 text-[var(--ink)] shadow-[3px_3px_0_0_var(--ink)] ring-0"
		>
			<ToggleGroup
				type="single"
				value={sky.view}
				onValueChange={pick}
				class="flex flex-col items-stretch rounded-none"
				aria-label="Time range"
			>
				{#each TABS as tab (tab.id)}
					<ToggleGroupItem value={tab.id} class={menuItemClass}>{tab.label}</ToggleGroupItem>
				{/each}
			</ToggleGroup>
		</PopoverContent>
	</Popover>
{:else}
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
{/if}
