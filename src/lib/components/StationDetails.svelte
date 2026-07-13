<script lang="ts">
	import type { Station } from '$lib/types';
	import { Popover, PopoverContent } from '$lib/components/ui/popover';
	import { Drawer, DrawerContent } from '$lib/components/ui/drawer';
	import StationCard from './StationCard.svelte';

	interface Props {
		code: string;
		station: Station;
		current: { h: number; m: number; l: number } | null;
		date: string;
		when: string;
		at: { x: number; y: number } | null;
		onclose: () => void;
	}
	let { code, station, current, date, when, at, onclose }: Props = $props();

	let open = $state(true);
	$effect(() => {
		if (!open) onclose();
	});

	let isMobile = $state(false);
	$effect(() => {
		const mq = window.matchMedia('(max-width: 640px), (pointer: coarse)');
		isMobile = mq.matches;
		const on = () => (isMobile = mq.matches);
		mq.addEventListener('change', on);
		return () => mq.removeEventListener('change', on);
	});

	$effect(() => {
		if (isMobile) return;
		const onScroll = () => onclose();
		window.addEventListener('scroll', onScroll, { passive: true });
		return () => window.removeEventListener('scroll', onScroll);
	});

	let anchor = $derived({
		getBoundingClientRect: () => {
			const x = at?.x ?? window.innerWidth / 2;
			const y = at?.y ?? window.innerHeight * 0.28;
			return new DOMRect(x, y, 0, 0);
		}
	});
</script>

{#if isMobile}
	<Drawer bind:open shouldScaleBackground={false}>
		<DrawerContent
			class="max-h-[85vh] gap-0 border-2 border-ink bg-paper px-4 pt-1 pb-4 text-ink"
		>
			<div class="sheet-scroll max-h-[calc(85vh-40px)] overflow-y-auto">
				<StationCard {code} {station} {current} {date} {when} {onclose} />
			</div>
		</DrawerContent>
	</Drawer>
{:else}
	<Popover bind:open>
		<PopoverContent
			customAnchor={anchor}
			side="top"
			sideOffset={14}
			collisionPadding={16}
			class="w-[340px] max-w-[calc(100vw-24px)] gap-0 border-2 border-ink bg-paper p-3 text-ink ring-0"
		>
			<StationCard {code} {station} {current} {date} {when} {onclose} />
		</PopoverContent>
	</Popover>
{/if}
