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
	import { SearchIcon, Location01Icon } from '@hugeicons/core-free-icons';

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
		class="w-[280px] rounded-none border-2 border-[var(--ink)] bg-[var(--paper)] p-0 text-[var(--ink)] shadow-[3px_3px_0_0_var(--ink)] ring-0"
	>
		<Command shouldFilter={false} class="rounded-none bg-transparent p-0">
			<CommandInput bind:value={query} placeholder="Search name or code…" />
			<CommandList class="max-h-[280px]">
				<CommandEmpty>No station found.</CommandEmpty>
				{#each results as st (st.code)}
					<CommandItem
						value={st.code}
						onSelect={() => pick(st.code)}
						class="rounded-none data-selected:bg-[var(--cloud-block)] data-selected:text-[var(--ink)]"
					>
						<HugeiconsIcon icon={Location01Icon} strokeWidth={2} class="opacity-50" />
						<span class="name">{st.name}</span>
						{#if st.state}<span class="state">{st.state}</span>{/if}
						<span class="code">{st.code}</span>
					</CommandItem>
				{/each}
			</CommandList>
		</Command>
	</PopoverContent>
</Popover>

<style>
	.name {
		font-family: var(--font-body);
		font-size: 13px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.state {
		font-size: 11px;
		opacity: 0.55;
		white-space: nowrap;
	}
	.code {
		margin-left: auto;
		font-family: var(--font-display);
		font-size: 9px;
		letter-spacing: 0.05em;
		opacity: 0.65;
		flex-shrink: 0;
	}
</style>
