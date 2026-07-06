<script lang="ts">
	import type { StationsManifest } from '$lib/types';
	import { Popover, PopoverContent, PopoverTrigger } from '$lib/components/ui/popover';
	import {
		Command,
		CommandInput,
		CommandList,
		CommandEmpty,
		CommandItem
	} from '$lib/components/ui/command';
	import { Button } from '$lib/components/ui/button';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { SearchIcon } from '@hugeicons/core-free-icons';

	interface Props {
		manifest: StationsManifest;
		onselect?: (code: string) => void;
	}
	let { manifest, onselect }: Props = $props();

	let open = $state(false);
	let query = $state('');

	let all = $derived(
		Object.entries(manifest.stations)
			.map(([code, s]) => ({ code, name: s.name, state: s.state }))
			.sort((a, b) => a.name.localeCompare(b.name))
	);

	// Own filtering (Command's is off) so we can cap the list — 1,200+ items would
	// choke the DOM. Match on name, code, or state; show a handful by default.
	let results = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return all.slice(0, 8);
		const out: typeof all = [];
		for (const st of all) {
			if (
				st.name.toLowerCase().includes(q) ||
				st.code.toLowerCase().includes(q) ||
				st.state?.toLowerCase().includes(q)
			) {
				out.push(st);
				if (out.length >= 50) break;
			}
		}
		return out;
	});

	function pick(code: string) {
		onselect?.(code);
		open = false;
		query = '';
	}
</script>

<Popover bind:open>
	<PopoverTrigger>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="outline"
				size="sm"
				class="rounded-none border-2 border-[var(--ink)] bg-[var(--paper)] text-[10px] tracking-wider text-[var(--ink)] uppercase shadow-none [font-family:var(--font-display)] hover:bg-[var(--cloud-block)] hover:text-[var(--ink)]"
			>
				<HugeiconsIcon icon={SearchIcon} strokeWidth={2} />
				<span>Find a station</span>
			</Button>
		{/snippet}
	</PopoverTrigger>
	<PopoverContent
		align="end"
		sideOffset={6}
		class="w-[300px] rounded-none border-2 border-[var(--ink)] bg-[var(--paper)] p-0 text-[var(--ink)] shadow-[3px_3px_0_0_var(--ink)] ring-0
			[&_[data-slot=command-input-wrapper]]:p-0
			[&_[data-slot=input-group]]:!h-9 [&_[data-slot=input-group]]:!rounded-none [&_[data-slot=input-group]]:!border-0 [&_[data-slot=input-group]]:!border-b-2 [&_[data-slot=input-group]]:!border-[var(--ink)] [&_[data-slot=input-group]]:!bg-[var(--paper)] [&_[data-slot=input-group]]:!shadow-none"
	>
		<Command shouldFilter={false} class="rounded-none bg-transparent p-0">
			<CommandInput bind:value={query} placeholder="Search name or code…" />
			<CommandList class="max-h-[280px] p-1">
				<CommandEmpty class="py-4 text-center text-[11px] tracking-wider [font-family:var(--font-display)]"
					>No station found.</CommandEmpty
				>
				{#each results as st (st.code)}
					<CommandItem
						value={st.code}
						onSelect={() => pick(st.code)}
						class="flex items-center gap-2 rounded-none px-2 py-1 data-selected:bg-[var(--cloud-block)] data-selected:text-[var(--ink)]"
					>
						<span class="label">
							<span class="name">{st.name}</span>
							{#if st.state}<span class="state">{st.state}</span>{/if}
						</span>
						<span class="code">{st.code}</span>
					</CommandItem>
				{/each}
			</CommandList>
		</Command>
	</PopoverContent>
</Popover>

<style>
	/* Name + state truncate together as one label so the code column stays
	   aligned on the right and names only clip when the row is genuinely full. */
	.label {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-body);
		font-size: 13px;
	}
	.name {
		color: var(--ink);
	}
	.state {
		margin-left: 6px;
		font-size: 11px;
		opacity: 0.5;
	}
	.code {
		flex: 0 0 auto;
		font-family: var(--font-display);
		font-size: 9px;
		letter-spacing: 0.05em;
		opacity: 0.55;
	}
</style>
