<script lang="ts">
	import type { Station, Rollup } from '$lib/types';
	import { Popover, PopoverContent } from '$lib/components/ui/popover';
	import { Drawer, DrawerContent } from '$lib/components/ui/drawer';
	import StationCard from './StationCard.svelte';

	interface Props {
		code: string;
		station: Station;
		current: { h: number; m: number; l: number } | null;
		rollup: Rollup | null;
		date: string;
		/** Scrub-aware time descriptor, e.g. "15:00 IST" or "DAILY MEAN". */
		when: string;
		/** Screen point the card should anchor to on desktop (the click). */
		at: { x: number; y: number } | null;
		onclose: () => void;
	}
	let { code, station, current, rollup, date, when, at, onclose }: Props = $props();

	// The card mounts already-open (parent only renders it for a selected station).
	// When the popover/drawer closes itself (swipe, click-away, Esc), open flips
	// false and we tell the parent to clear the selection.
	let open = $state(true);
	$effect(() => {
		if (!open) onclose();
	});

	// Coarse-pointer / narrow screens get the bottom sheet; everything else the
	// anchored popover. Reactive so a resize or device rotation re-routes.
	let isMobile = $state(false);
	$effect(() => {
		const mq = window.matchMedia('(max-width: 640px), (pointer: coarse)');
		isMobile = mq.matches;
		const on = () => (isMobile = mq.matches);
		mq.addEventListener('change', on);
		return () => mq.removeEventListener('change', on);
	});

	// The desktop popover is anchored to a fixed screen point, so scrolling the
	// page would leave it stranded. Dismiss on page scroll. (window's scroll only
	// fires for the viewport, not the card's own internal scroll area.)
	$effect(() => {
		if (isMobile) return;
		const onScroll = () => onclose();
		window.addEventListener('scroll', onScroll, { passive: true });
		return () => window.removeEventListener('scroll', onScroll);
	});

	// A virtual anchor at the click point for the desktop popover. Falls back to
	// upper-centre when opened without a point (search / streak selection).
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
			class="max-h-[85vh] gap-0 border-0 bg-paper p-4 pt-2 text-ink before:border-2 before:border-ink before:bg-paper"
		>
			<div class="sheet-scroll max-h-[calc(85vh-40px)] overflow-y-auto">
				<StationCard {code} {station} {current} {rollup} {date} {when} {onclose} />
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
			<StationCard {code} {station} {current} {rollup} {date} {when} {onclose} />
		</PopoverContent>
	</Popover>
{/if}
