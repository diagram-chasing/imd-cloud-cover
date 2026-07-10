<script lang="ts">
	import type { StationsManifest, PlaceProps } from '$lib/types';
	import type { FeatureCollection } from 'geojson';
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
		/** Baked cities/towns (static/data/india-places.json). Optional so the map
		    still renders if the file is missing. */
		places?: FeatureCollection;
		onselect?: (code: string) => void;
		/** Icon-only square trigger (mobile top corner). */
		compact?: boolean;
		/** Which side of the trigger the palette opens on. */
		side?: 'top' | 'bottom';
		align?: 'start' | 'end';
	}
	let {
		manifest,
		places,
		onselect,
		compact = false,
		side = 'bottom',
		align = 'end'
	}: Props = $props();

	let open = $state(false);
	let query = $state('');

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

	// One index over stations + cities. A city whose name collides with a station
	// is dropped — the station carries data, so it wins — but its aliases move onto
	// the station so exonyms still resolve (station "Mumbai" inherits "Bombay").
	let index = $derived.by(() => {
		const cityAlias = new Map<string, string[]>();
		for (const f of places?.features ?? []) {
			const p = f.properties as unknown as PlaceProps;
			if (!p?.name || !p.aliases?.length) continue;
			const n = norm(p.name);
			cityAlias.set(n, [...(cityAlias.get(n) ?? []), ...p.aliases]);
		}
		const stationNames = new Set<string>();
		const out: Entry[] = [];
		for (const [code, s] of Object.entries(manifest.stations)) {
			const nn = norm(s.name);
			stationNames.add(nn);
			out.push({
				kind: 'station',
				name: s.name,
				state: s.state,
				code,
				near: null,
				nkm: 0,
				pop: 0,
				nameN: nn,
				aliasN: (cityAlias.get(nn) ?? []).map(norm),
				codeN: norm(code),
				stateN: s.state ? norm(s.state) : ''
			});
		}
		for (const f of places?.features ?? []) {
			const p = f.properties as unknown as PlaceProps;
			if (!p?.name || stationNames.has(norm(p.name))) continue;
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
		return out;
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
		scored.sort(
			(a, b) =>
				a.s - b.s ||
				// stations first on ties (they carry data), then prominence, then name
				(a.e.kind === 'station' ? 0 : 1) - (b.e.kind === 'station' ? 0 : 1) ||
				b.e.pop - a.e.pop ||
				a.e.name.localeCompare(b.e.name)
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
			<Button
				{...props}
				variant="outline"
				size={compact ? 'icon' : 'sm'}
				aria-label="Find a city or station"
				class="{compact
					? 'size-8'
					: 'h-11 px-3'} rounded-none border-2 border-ink bg-paper text-xs tracking-wider text-ink uppercase shadow-none hover:bg-cloud-block hover:text-ink"
			>
				<HugeiconsIcon icon={SearchIcon} strokeWidth={2} />
				{#if !compact}<span>Find a place</span>{/if}
			</Button>
		{/snippet}
	</PopoverTrigger>
	<PopoverContent
		{side}
		{align}
		collisionPadding={12}
		sideOffset={6}
		class="w-[300px] rounded-none border-2 border-ink bg-paper p-0 text-ink shadow-[3px_3px_0_0] shadow-ink ring-0
			[&_[data-slot=command-input-wrapper]]:p-0
			[&_[data-slot=input-group]]:!h-9 [&_[data-slot=input-group]]:!rounded-none [&_[data-slot=input-group]]:!border-0 [&_[data-slot=input-group]]:!border-b-2 [&_[data-slot=input-group]]:!border-ink [&_[data-slot=input-group]]:!bg-paper [&_[data-slot=input-group]]:!shadow-none"
	>
		<Command shouldFilter={false} class="rounded-none bg-transparent p-0">
			<CommandInput bind:value={query} placeholder="Search a city or station…" />
			<CommandList class="max-h-[280px] p-1">
				<CommandEmpty class="py-4 text-center text-xs tracking-wider">No match.</CommandEmpty>
				{#each results as e, i (`${e.kind}:${e.name}:${e.state ?? ''}:${i}`)}
					<CommandItem
						value={`${e.name}:${e.kind}:${i}`}
						onSelect={() => pick(e)}
						class="flex items-center gap-2 rounded-none px-2 py-1 data-selected:bg-cloud-block data-selected:text-ink"
					>
						<!-- Name + state truncate together as one label so the code column stays
						     aligned on the right and names only clip when the row is genuinely full. -->
						<span class="label min-w-0 flex-auto truncate text-sm">
							<span class="name text-ink">{e.name}</span>
							{#if e.state}<span class="state ml-1.5 text-xs opacity-50">{e.state}</span>{/if}
						</span>
						{#if e.kind === 'station'}
							<span class="code flex-none text-xs tracking-wider opacity-55">{e.code}</span>
						{:else}
							<span
								class="tag flex-none border border-ink/40 px-[3px] py-px text-xs tracking-[0.08em] uppercase opacity-50"
								>city</span
							>
						{/if}
					</CommandItem>
				{/each}
			</CommandList>
		</Command>
	</PopoverContent>
</Popover>
