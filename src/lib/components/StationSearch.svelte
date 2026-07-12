<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import type { StationsManifest, PlaceProps } from '$lib/types';
	import type { FeatureCollection } from 'geojson';
	import { Command as CommandPrimitive } from 'bits-ui';
	import { Popover, PopoverContent, PopoverTrigger } from '$lib/components/ui/popover';
	import PixelButton from '$lib/components/PixelButton.svelte';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { SearchIcon } from '@hugeicons/core-free-icons';

	interface Props {
		manifest: StationsManifest;
		/** Baked cities/towns (static/data/india-places.json). Optional so the map
		    still renders if the file is missing. */
		places?: FeatureCollection;
		onselect?: (code: string) => void;
		/** Icon-only square trigger (mobile top corner). */
		compact?: boolean;
		/** Which side of the trigger the palette opens on. */
		side?: 'top' | 'bottom';
		align?: 'start' | 'end';
		/** Only offer entries resolving to one of these station codes (the city
		    explorer passes the codes present in cities.json). */
		codes?: Set<string>;
		/** Cities outrank stations on tie-breaks and the trigger says so. */
		cityFirst?: boolean;
		/** Custom trigger markup; receives the popover trigger props to spread. */
		trigger?: Snippet<[Record<string, unknown>]>;
	}
	let {
		manifest,
		places,
		onselect,
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

	// The popover portals its content next to the trigger, but on open bits-ui
	// focuses the field before Floating UI has positioned it — so the browser
	// scrolls the still-at-origin input into view and the page jumps. Take focus
	// ourselves, after a tick, with scrolling suppressed.
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
		kind: 'station' | 'city';
		name: string;
		state: string | null;
		/** For a station, its code; for a city, its nearest station's code. */
		code: string | null;
		/** City-only: nearest station name + distance for the sublabel. */
		near: string | null;
		nkm: number;
		pop: number;
		nameN: string;
		aliasN: string[];
		codeN: string;
		stateN: string;
	}

	let index = $derived.by(() => {
		// True when this place is the one the station already represents.
		const isSamePlace = (p: PlaceProps) => {
			const near = p.nearest ? manifest.stations[p.nearest] : null;
			return !!near && norm(near.name) === norm(p.name);
		};
		// Aliases inherited by a station code from the city that shares its identity.
		const stationAlias = new Map<string, string[]>();
		for (const f of places?.features ?? []) {
			const p = f.properties as unknown as PlaceProps;
			if (!p?.name || !p.aliases?.length || !p.nearest || !isSamePlace(p)) continue;
			stationAlias.set(p.nearest, [...(stationAlias.get(p.nearest) ?? []), ...p.aliases]);
		}
		const out: Entry[] = [];
		for (const [code, s] of Object.entries(manifest.stations)) {
			const nn = norm(s.name);
			out.push({
				kind: 'station',
				name: s.name,
				state: s.state,
				code,
				near: null,
				nkm: 0,
				pop: 0,
				nameN: nn,
				aliasN: (stationAlias.get(code) ?? []).map(norm),
				codeN: norm(code),
				stateN: s.state ? norm(s.state) : ''
			});
		}
		for (const f of places?.features ?? []) {
			const p = f.properties as unknown as PlaceProps;
			if (!p?.name || isSamePlace(p)) continue;
			out.push({
				kind: 'city',
				name: p.name,
				state: p.state,
				code: p.nearest,
				near: p.nearest ? (manifest.stations[p.nearest]?.name ?? null) : null,
				nkm: p.nkm,
				pop: p.pop,
				nameN: norm(p.name),
				aliasN: (p.aliases ?? []).map(norm),
				codeN: '',
				stateN: p.state ? norm(p.state) : ''
			});
		}
		return codes ? out.filter((e) => e.code && codes.has(e.code)) : out;
	});

	// Lower score = better. Prefix hits beat word-boundary beats substring; name
	// beats alias beats state/code. Returns Infinity for a non-match.
	function score(e: Entry, q: string): number {
		if (e.nameN.startsWith(q)) return 0;
		if (new RegExp('\\b' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(e.nameN)) return 1;
		for (const a of e.aliasN) if (a.startsWith(q)) return 2;
		if (e.nameN.includes(q)) return 3;
		for (const a of e.aliasN) if (a.includes(q)) return 4;
		if (e.stateN.includes(q)) return 5;
		if (e.codeN.includes(q)) return 5;
		return Infinity;
	}

	let results = $derived.by(() => {
		const q = norm(query);
		if (!q) {
			// Default: the biggest cities as jumping-off points.
			return [...index]
				.filter((e) => e.kind === 'city')
				.sort((a, b) => b.pop - a.pop)
				.slice(0, 8);
		}
		const scored: { e: Entry; s: number }[] = [];
		for (const e of index) {
			const s = score(e, q);
			if (s !== Infinity) scored.push({ e, s });
		}
		// Stations first on ties (they carry data) — unless the caller is city-
		// centric, where the place name is the identity people search for.
		const lead = (e: Entry) => (e.kind === (cityFirst ? 'city' : 'station') ? 0 : 1);
		scored.sort(
			(a, b) =>
				a.s - b.s || lead(a.e) - lead(b.e) || b.e.pop - a.e.pop || a.e.name.localeCompare(b.e.name)
		);
		return scored.slice(0, 50).map((x) => x.e);
	});

	function pick(e: Entry) {
		if (e.code) onselect?.(e.code);
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
				<!-- Paper pixel key; compact drops the text and squares the cap padding. -->
				<PixelButton
					{...props}
					size="sm"
					cap="paper"
					aria-label={cityFirst ? 'Find your city' : 'Find a city or station'}
					class="text-xs tracking-wider uppercase"
					style={compact ? '--pad: 4px 7px' : undefined}
				>
					<span class="flex items-center gap-1.5">
						<HugeiconsIcon icon={SearchIcon} strokeWidth={2} size={16} />
						{#if !compact}<span>{cityFirst ? 'Find your city' : 'Find a place'}</span>{/if}
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
			<!-- Search field, built to the house style: a single ink underline, no
			     input-group chrome, no browser focus ring collision. -->
			<div class="flex items-center gap-2 border-b-2 border-ink px-3">
				<HugeiconsIcon icon={SearchIcon} strokeWidth={2} size={15} class="shrink-0 text-ink/45" />
				<CommandPrimitive.Input
					bind:ref={inputEl}
					bind:value={query}
					placeholder={cityFirst ? 'Search a city…' : 'Search a city or station…'}
					class="station-search-input h-10 w-full min-w-0 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink/40"
				/>
			</div>
			<CommandPrimitive.List class="max-h-[300px] overflow-x-hidden overflow-y-auto p-1.5">
				{#if results.length === 0}
					<p class="py-6 text-center text-xs tracking-wider text-ink/55 uppercase">No match</p>
				{:else}
					{#if !norm(query)}
						<p class="px-2 pt-1 pb-1.5 text-xs uppercase">
							{cityFirst ? 'Biggest cities' : 'Popular places'}
						</p>
					{/if}
					{#each results as e, i (`${e.kind}:${e.name}:${e.state ?? ''}:${i}`)}
						<CommandPrimitive.Item
							value={`${e.name}:${e.kind}:${i}`}
							onSelect={() => pick(e)}
							class="flex cursor-pointer items-center gap-2 rounded-none px-2 py-1.5 text-ink outline-none select-none data-selected:bg-cloud-block data-selected:text-ink"
						>
							<!-- Name + state truncate together as one label so the code column stays
							     aligned on the right and names only clip when the row is genuinely full. -->
							<span class="min-w-0 flex-auto truncate">
								<span class="text-base uppercase text-ink">{e.name}</span>
								{#if e.state}<span class="ml-1.5 text-xs text-ink/45">{e.state}</span>{/if}
							</span>
							<span class="flex-none text-xs text-ink/90 uppercase">
								{e.kind === 'station' ? 'Station' : 'City'}
							</span>
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
