<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import type { StationsManifest } from '$lib/types';
	import { titleCase } from '$lib/format';
	import { Command as CommandPrimitive } from 'bits-ui';
	import { Popover, PopoverContent, PopoverTrigger } from '$lib/components/ui/popover';
	import PixelButton from '$lib/components/PixelButton.svelte';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { SearchIcon, Location01Icon } from '@hugeicons/core-free-icons';
	import { userGeo } from '$lib/state/geo.svelte';

	interface Props {
		manifest: StationsManifest;
		onselect?: (code: string) => void;
		/** Fly the map to the visitor's resolved location (shown as the first row). */
		onmylocation?: () => void;
		/** Icon-only square trigger (mobile top corner). */
		compact?: boolean;
		/** Which side of the trigger the palette opens on. */
		side?: 'top' | 'bottom';
		align?: 'start' | 'end';
		/** Only offer entries resolving to one of these station codes (the city
		    explorer passes the codes present in cities.json). */
		codes?: Set<string>;
		/** Label the trigger for the city explorer ("Find your city"). */
		cityFirst?: boolean;
		/** Custom trigger markup; receives the popover trigger props to spread. */
		trigger?: Snippet<[Record<string, unknown>]>;
	}
	let {
		manifest,
		onselect,
		onmylocation,
		compact = false,
		side = 'bottom',
		align = 'end',
		codes,
		cityFirst = false,
		trigger
	}: Props = $props();

	let open = $state(false);
	let query = $state('');
	let inputEl = $state<HTMLInputElement | null>(null);

	// bits-ui focuses before Floating UI positions - browser scrolls to origin. take focus after a tick
	function focusInput(e: Event) {
		e.preventDefault();
		tick().then(() => inputEl?.focus({ preventScroll: true }));
	}

	const norm = (s: string) =>
		s
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase()
			.trim();

	interface Entry {
		name: string;
		state: string | null;
		district: string | null;
		code: string;
		pop: number;
		nameN: string;
		aliasN: string[];
		codeN: string;
		stateN: string;
		districtN: string;
	}

	// Place = station: one entry per IMD station, searchable by name, aliases
	// (Bombay/Madras…), district, state and code. No separate cities corpus, so a
	// query like "Kanpur" no longer returns duplicate station+city rows.
	let index = $derived.by(() => {
		const out: Entry[] = [];
		for (const [code, s] of Object.entries(manifest.stations)) {
			// Skip duplicate places (a district meteogram + point station in the same
			// district); the canonical station stands in for them. `codes` (explorer)
			// is already canonical, so it isn't re-filtered.
			if (!codes && s.canonical === false) continue;
			out.push({
				name: s.name,
				state: s.state,
				district: s.district ?? null,
				code,
				pop: s.pop ?? 0,
				nameN: norm(s.name),
				aliasN: (s.aliases ?? []).map(norm),
				codeN: norm(code),
				stateN: s.state ? norm(s.state) : '',
				districtN: s.district ? norm(s.district) : ''
			});
		}
		return codes ? out.filter((e) => codes.has(e.code)) : out;
	});

	// lower = better: prefix > word-boundary > substring; name > alias > district/state/code
	function score(e: Entry, q: string): number {
		if (e.nameN.startsWith(q)) return 0;
		if (new RegExp('\\b' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(e.nameN)) return 1;
		for (const a of e.aliasN) if (a.startsWith(q)) return 2;
		if (e.districtN.startsWith(q)) return 2;
		if (e.nameN.includes(q)) return 3;
		for (const a of e.aliasN) if (a.includes(q)) return 4;
		if (e.districtN.includes(q)) return 4;
		if (e.stateN.includes(q)) return 5;
		if (e.codeN.includes(q)) return 5;
		return Infinity;
	}

	let results = $derived.by(() => {
		const q = norm(query);
		if (!q) {
			// no query: show the biggest places as defaults
			return [...index].sort((a, b) => b.pop - a.pop).slice(0, 8);
		}
		const scored: { e: Entry; s: number }[] = [];
		for (const e of index) {
			const s = score(e, q);
			if (s !== Infinity) scored.push({ e, s });
		}
		scored.sort(
			(a, b) => a.s - b.s || b.e.pop - a.e.pop || a.e.name.localeCompare(b.e.name)
		);
		return scored.slice(0, 50).map((x) => x.e);
	});

	function pick(e: Entry) {
		if (e.code) onselect?.(e.code);
		open = false;
		query = '';
	}

	// Only offered once the geo worker has resolved a usable point.
	let hasLocation = $derived(onmylocation != null && userGeo.loc != null);
	function pickLocation() {
		onmylocation?.();
		open = false;
		query = '';
	}
</script>

<Popover bind:open>
	<PopoverTrigger>
		{#snippet child({ props })}
			{#if trigger}
				{@render trigger(props)}
			{:else}
				<PixelButton
					{...props}
					size="sm"
					cap="paper"
					aria-label={cityFirst ? 'Find your station' : 'Find a station'}
					class="text-xs tracking-wider uppercase"
					style={compact ? '--pad: 4px 7px' : undefined}
				>
					<span class="flex items-center gap-1.5">
						<HugeiconsIcon icon={SearchIcon} strokeWidth={2} size={16} />
						{#if !compact}<span>{cityFirst ? 'Find your station' : 'Find a station'}</span>{/if}
					</span>
				</PixelButton>
			{/if}
		{/snippet}
	</PopoverTrigger>
	<PopoverContent
		{side}
		{align}
		collisionPadding={12}
		sideOffset={6}
		onOpenAutoFocus={focusInput}
		class="w-[320px] max-w-[calc(100vw-1.5rem)] gap-0 rounded-none border-2 border-ink bg-paper p-0 text-ink shadow-[3px_3px_0_0] ring-0 shadow-ink"
	>
		<CommandPrimitive.Root shouldFilter={false} disableInitialScroll class="flex flex-col">
			<div class="flex items-center gap-2 border-b-2 border-ink px-3">
				<HugeiconsIcon icon={SearchIcon} strokeWidth={2} size={15} class="shrink-0 text-ink/45" />
				<CommandPrimitive.Input
					bind:ref={inputEl}
					bind:value={query}
					placeholder={cityFirst ? 'Search a station…' : 'Search a station…'}
					class="station-search-input h-10 w-full min-w-0 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink/40"
				/>
			</div>
			<CommandPrimitive.List class="max-h-[300px] overflow-x-hidden overflow-y-auto p-1.5">
				{#if hasLocation}
					<CommandPrimitive.Item
						value="__my-location__"
						onSelect={pickLocation}
						class="mb-1 flex cursor-pointer items-center gap-2 rounded-none border-b border-ink/10 px-2 py-1.5 pb-2 text-ink outline-none select-none data-selected:bg-cloud-block data-selected:text-ink"
					>
						<HugeiconsIcon icon={Location01Icon} strokeWidth={2} size={15} class="shrink-0 text-ink/55" />
						<span class="min-w-0 flex-auto truncate text-sm tracking-wide uppercase text-ink"
							>My location</span
						>
					</CommandPrimitive.Item>
				{/if}
				{#if results.length === 0}
					<p class="py-6 text-center text-xs tracking-wider text-ink/55 uppercase">No match</p>
				{:else}
					{#if !norm(query)}
						<p class="px-2 pt-1 pb-1.5 text-xs uppercase">
							{cityFirst ? 'Biggest stations' : 'Popular stations'}
						</p>
					{/if}
					{#each results as e, i (`${e.code}:${i}`)}
						<CommandPrimitive.Item
							value={`${e.name}:${e.code}:${i}`}
							onSelect={() => pick(e)}
							class="flex cursor-pointer items-center gap-2 rounded-none px-2 py-1.5 text-ink outline-none select-none data-selected:bg-cloud-block data-selected:text-ink"
						>
							<span class="min-w-0 flex-auto truncate">
								<span class="text-base uppercase text-ink">{e.name}</span>
								{#if e.state}<span class="ml-1.5 text-xs text-ink/45"
										>{titleCase(e.district && norm(e.district) !== e.nameN ? `${e.district}, ${e.state}` : e.state)}</span
									>{/if}
							</span>
							<span class="flex-none font-mono text-xs text-ink/45 uppercase">{e.code}</span>
						</CommandPrimitive.Item>
					{/each}
				{/if}
			</CommandPrimitive.List>
		</CommandPrimitive.Root>
	</PopoverContent>
</Popover>

<style>
	/* The field is auto-focused every time the palette opens, so the site-wide
	   focus ring would sit around it permanently and clash with the paper card.
	   The open popover is itself the focus affordance. (Scoped by the marker
	   class since the input is rendered inside a child component.) */
	:global(.station-search-input:focus-visible) {
		outline: none;
	}
</style>
