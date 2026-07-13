<script lang="ts">
	import { MediaQuery } from 'svelte/reactivity';
	import { select, curveLinear } from 'd3';
	import {
		annotation as makeAnnotation,
		annotationCalloutCurve,
		annotationXYThreshold
	} from 'd3-svg-annotation';
	import methodImg from '$lib/assets/method-meteogram.webp';
	import * as Carousel from '$lib/components/ui/carousel/index.js';
	import type { CarouselAPI } from '$lib/components/ui/carousel/context.js';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { Cancel01Icon } from '@hugeicons/core-free-icons';

	type Rect = { x: number; y: number; w: number; h: number };
	type Region = {
		id: string;
		n: number;
		title: string;
		note: string;
		rect: Rect;
		pad?: [number, number];
		nudgeX?: number;
		mark: { x: number; y: number };
		side: 'left' | 'right';
		anchorY: number;
	};

	const SRC = methodImg;

	const PLOT_X = 10.91;
	const PLOT_W = 88.18;

	const REGIONS: Region[] = [
		{
			id: 'upper-air',
			n: 1,
			side: 'left',
			anchorY: 12,
			title: 'UPPER AIR',
			note: 'A cross-section of the sky up to about 5 km. Barbs show wind direction; green shading shows how moist the air is at each height.',
			rect: { x: PLOT_X, y: 6.36, w: PLOT_W, h: 33.64 },
			mark: { x: 20, y: 19.5 }
		},
		{
			id: 'pressure',
			n: 2,
			side: 'right',
			anchorY: 11,
			title: 'PRESSURE & THICKNESS',
			note: 'Air pressure at sea level. A second line tracks how warm the whole air column is.',
			rect: { x: PLOT_X, y: 41, w: PLOT_W, h: 6.8 },
			pad: [0.5, 0.12],
			mark: { x: 85, y: 44.2 }
		},
		{
			id: 'instability',
			n: 3,
			side: 'left',
			anchorY: 43.5,
			title: 'INSTABILITY',
			note: 'How likely the atmosphere is to build storms. Taller bars mean more unstable air.',
			rect: { x: PLOT_X, y: 48, w: PLOT_W, h: 7.3 },
			pad: [0.28, 0.26],
			mark: { x: 20, y: 51.8 }
		},
		{
			id: 'wind',
			n: 4,
			side: 'right',
			anchorY: 37.5,
			title: 'SURFACE WIND',
			note: 'Wind speed and direction 10 m above the ground.',
			rect: { x: PLOT_X, y: 55.65, w: PLOT_W, h: 7.33 },
			pad: [0.34, 0.3],
			mark: { x: 85, y: 59.4 }
		},
		{
			id: 'temperature',
			n: 5,
			side: 'left',
			anchorY: 68.5,
			title: 'TEMPERATURE',
			note: 'The day-night swing of air temperature in celsius. Whiskers mark the high and low within each 3-hour window.',
			rect: { x: PLOT_X, y: 63.78, w: PLOT_W, h: 6.93 },
			pad: [0.56, 0.12],
			mark: { x: 20, y: 66.9 }
		},
		{
			id: 'humidity',
			n: 6,
			side: 'right',
			anchorY: 63,
			title: 'HUMIDITY',
			note: 'How much moisture the air is holding, as a percentage of what it could hold.',
			rect: { x: PLOT_X, y: 70.75, w: PLOT_W, h: 7.73 },
			pad: [0, 0.22],
			nudgeX: 1.2,

			mark: { x: 85, y: 74.9 }
		},
		{
			id: 'cloud',
			n: 7,
			side: 'right',
			anchorY: 91.5,
			title: 'CLOUD COVER',
			note: 'How much of the sky is covered, split into low, middle and high decks.',
			rect: { x: PLOT_X, y: 78.64, w: PLOT_W, h: 7.42 },
			pad: [0, 0],
			nudgeX: 1.2,
			mark: { x: 85, y: 82.4 }
		},
		{
			id: 'precip',
			n: 8,
			side: 'left',
			anchorY: 92.5,
			title: 'PRECIPITATION',
			note: 'Rain expected in each 3-hour window. Green is the total; red is the share from thunderstorms.',
			rect: { x: PLOT_X, y: 86.46, w: PLOT_W, h: 10 },
			nudgeX: 1.2,

			mark: { x: 20, y: 91.5 }
		}
	];

	const narrow = new MediaQuery('(max-width: 1099px)');

	let hovered = $state<string | null>(null);
	let pinned = $state<string | null>(null);
	let swipeActive = $state<string | null>(null);
	let deckDismissed = $state(false);
	const active = $derived(
		pinned ?? hovered ?? (narrow.current && !deckDismissed ? swipeActive : null)
	);

	const shown = $derived(active ?? (narrow.current ? null : 'cloud'));
	const dimming = $derived(active !== null);
	const cur = $derived(REGIONS.find((r) => r.id === shown) ?? REGIONS[6]);

	let root: HTMLElement | undefined = $state();

	const IMG_L = 22;
	const IMG_W = 56;
	const CARD_L = 19.5;
	const CARD_R = 80.5;

	let aw = $state(0);
	let ah = $state(0);
	let leadsEl: SVGSVGElement | undefined = $state();

	$effect(() => {
		const svg = leadsEl;
		if (!svg || !aw || !ah || narrow.current) return;
		const STUB = 12;
		const ELBOW = 14;
		const specs = REGIONS.map((r) => {
			const dir = r.side === 'left' ? -1 : 1;
			const sx = ((IMG_L + (r.mark.x * IMG_W) / 100) / 100) * aw;
			const sy = (r.mark.y / 100) * ah;
			const ex = ((r.side === 'left' ? CARD_L : CARD_R) / 100) * aw;
			const ey = (r.anchorY / 100) * ah;
			const bendX = ex - dir * (STUB + ELBOW);
			const dy = ey - sy;
			const k = Math.min(ELBOW, Math.abs(dy));
			const points: [number, number][] = [
				[bendX - sx, 0],
				[bendX - sx, dy - Math.sign(dy) * k],
				[bendX + dir * k - sx, dy]
			];
			return {
				x: sx,
				y: sy,
				nx: ex,
				ny: ey,
				className: `lead-${r.id}${shown === r.id ? ' hot' : ''}`,
				disable: ['note', 'subject'],
				note: {},
				connector: { points, curve: curveLinear }
			};
		});
		const bx0 = ((IMG_L + (PLOT_X * IMG_W) / 100) / 100) * aw;
		const bx1 = ((IMG_L + ((PLOT_X + PLOT_W) * IMG_W) / 100) / 100) * aw;
		const spanY = ah + 16;
		const span = {
			x: (bx0 + bx1) / 2,
			y: spanY,
			dx: 0,
			dy: 9,
			className: 'span',
			type: annotationXYThreshold,
			disable: ['connector'],
			subject: { x1: bx0, x2: bx1 },
			note: { label: '10-DAY FORECAST WITH 3 HOUR INTERVALS', align: 'middle', wrap: 600 }
		};
		const sel = select(svg);
		sel.selectAll('*').remove();
		sel
			.append('g')
			.attr('class', 'casing')
			.call(makeAnnotation().type(annotationCalloutCurve).annotations(specs));
		sel
			.append('g')
			.attr('class', 'ink')
			.call(
				makeAnnotation()
					.type(annotationCalloutCurve)
					.annotations([...specs, span])
			);
		sel
			.append('path')
			.attr('class', 'span-ticks')
			.attr('d', `M ${bx0} ${spanY - 5} V ${spanY} M ${bx1} ${spanY - 5} V ${spanY}`);
	});

	function toggle(id: string) {
		pinned = pinned === id ? null : id;
	}

	function deckScrollTo(id: string) {
		const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		deckApi?.scrollTo(
			REGIONS.findIndex((r) => r.id === id),
			reduce
		);
	}

	function tapRegion(id: string) {
		toggle(id);
		if (pinned === id && window.matchMedia('(max-width: 1099px)').matches) {
			deckDismissed = false;
			deckScrollTo(id);
		}
	}

	function cardClick(id: string, ctx: string) {
		if (ctx === 'm') {
			pinned = null;
			deckDismissed = false;
			swipeActive = id;
			deckScrollTo(id);
		} else {
			toggle(id);
		}
	}

	function exitSpotlight() {
		pinned = null;
		hovered = null;
		deckDismissed = true;
	}

	let deckApi = $state<CarouselAPI>();

	$effect(() => {
		const api = deckApi;
		if (!api) return;
		const onSelect = () => {
			swipeActive = REGIONS[api.selectedScrollSnap()]?.id ?? null;
			deckDismissed = false;
		};
		onSelect();
		api.on('select', onSelect);
		return () => {
			api.off('select', onSelect);
		};
	});

	function cropStyle(rect: Rect) {
		return (
			`aspect-ratio:${rect.w} / ${rect.h};` +
			`background-image:url(${SRC});` +
			`background-size:${10000 / rect.w}% auto;` +
			`background-position:${(rect.x / (100 - rect.w)) * 100}% ${(rect.y / (100 - rect.h)) * 100}%`
		);
	}

	function chartCrop(r: Region, ctx: string) {
		const frac = r.id === 'upper-air' ? 1 : ctx === 'm' ? 0.31 : 0.34;
		const [pt, pb] = r.pad ?? [0, 0];
		return cropStyle({
			x: r.rect.x + (r.nudgeX ?? 0),
			y: r.rect.y - pt,
			w: PLOT_W * frac,
			h: r.rect.h + pt + pb
		});
	}

	function onWindowKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') pinned = null;
	}

	function onWindowPointerdown(e: PointerEvent) {
		if (pinned && root && !root.contains(e.target as Node)) pinned = null;
	}

	function onCardKeydown(e: KeyboardEvent, n: number) {
		if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
		e.preventDefault();
		const next = e.key === 'ArrowDown' ? n + 1 : n - 1;
		const twins = root?.querySelectorAll<HTMLElement>(`[data-card="${next}"]`) ?? [];
		for (const el of twins) {
			if (el.offsetParent !== null) {
				el.focus();
				break;
			}
		}
	}
</script>

{#snippet chart(r: Region, ctx: string)}
	<span
		class={[
			'chart block w-full border border-ink bg-white bg-no-repeat',
			ctx === 'm' && 'mt-auto',
			dimming && shown !== r.id && 'border-steel-400 opacity-55 grayscale'
		]}
		style={chartCrop(r, ctx)}
		aria-hidden="true"
	></span>
{/snippet}

{#snippet card(r: Region, ctx: string)}
	{@const muted = dimming && shown !== r.id}
	<button
		type="button"
		class={[
			'card flex w-full cursor-pointer appearance-none flex-col gap-1.5 border-2 border-transparent bg-paper px-2.5 pt-2 pb-2.5 text-left text-inherit transition-[box-shadow,border-color] duration-180 ease-[ease] motion-reduce:transition-none',
			shown === r.id && 'border-ink! shadow-[4px_4px_0] shadow-focus'
		]}
		data-card={r.n}
		aria-pressed={pinned === r.id}
		onpointerenter={() => ctx === 'd' && (hovered = r.id)}
		onpointerleave={() => ctx === 'd' && (hovered = null)}
		onfocus={() => ctx === 'd' && (hovered = r.id)}
		onblur={() => ctx === 'd' && (hovered = null)}
		onclick={() => cardClick(r.id, ctx)}
		onkeydown={(e) => onCardKeydown(e, r.n)}
	>
		<span class="card-head flex items-center gap-2">
			<span
				class={[
					'marker inline inline-flex h-[19px] w-[19px] flex-none items-center justify-center bg-ink text-xs leading-none font-bold text-paper',
					muted && 'bg-steel-500'
				]}>{r.n}</span
			>
			<span
				class={[
					'card-title text-sm font-bold tracking-[0.08em] text-ink uppercase',
					muted && 'text-steel-700'
				]}>{r.title}</span
			>
		</span>
		<span
			class={[
				'card-note text-sm leading-normal text-pretty text-muted-foreground',
				muted && 'text-steel-600'
			]}>{r.note}</span
		>

		{@render chart(r, ctx)}
	</button>
{/snippet}

<svelte:window onkeydown={onWindowKeydown} onpointerdown={onWindowPointerdown} />

<figure class={['specimen mx-auto mt-6 mb-0 md:mb-20', dimming && 'dimming']} bind:this={root}>
	<div
		class="atlas relative left-1/2 grid w-[min(100vw-48px,1380px)] -translate-x-1/2 [grid-template-columns:19.5%_56%_19.5%] [column-gap:2.5%] max-[1099px]:left-auto max-[1099px]:mx-auto max-[1099px]:block max-[1099px]:w-full max-[1099px]:max-w-[640px] max-[1099px]:translate-x-0"
		bind:clientWidth={aw}
		bind:clientHeight={ah}
	>
		<div
			class="mount relative col-start-2 overflow-hidden border-2 border-ink bg-white leading-none shadow-[6px_6px_0] shadow-cloud-block"
		>
			<img
				class="plate block h-auto w-full"
				src={SRC}
				alt="Sample IMD GFS meteogram for Bangalore: eight stacked forecast panels, described in the numbered notes."
			/>
			{#each REGIONS as r (r.id)}
				<button
					type="button"
					class="hotspot absolute cursor-pointer appearance-none border-0 bg-transparent p-0"
					tabindex="-1"
					aria-hidden="true"
					style="left:{r.rect.x}%; top:{r.rect.y}%; width:{r.rect.w}%; height:{r.rect.h}%"
					onpointerenter={() => (hovered = r.id)}
					onpointerleave={() => (hovered = null)}
					onclick={() => tapRegion(r.id)}
				></button>
			{/each}

			<div
				class={[
					'marquee pointer-events-none absolute border-2 border-focus transition-[left,top,width,height,box-shadow] duration-180 ease-[ease] motion-reduce:transition-none',
					dimming && 'shadow-[0_0_0_9999px_color-mix(in_srgb,var(--paper)_80%,transparent)]',
					shown === null && 'hidden'
				]}
				style="left:{cur.rect.x}%; top:{cur.rect.y}%; width:{cur.rect.w}%; height:{cur.rect.h}%"
				aria-hidden="true"
			></div>
			{#each REGIONS as r (r.id)}
				<span
					class={[
						'marker on-plate absolute z-[2] inline-flex h-[19px] w-[19px] -translate-x-1/2 -translate-y-1/2 items-center justify-center bg-ink text-xs leading-none font-bold text-paper shadow-[0_0_0_2px] shadow-paper transition-[background,color] duration-180 ease-[ease] motion-reduce:transition-none max-[1099px]:hidden',
						shown === r.id ? 'bg-focus text-ink' : dimming && 'bg-steel-500 text-paper'
					]}
					style="left:{r.mark.x}%; top:{r.mark.y}%"
					aria-hidden="true">{r.n}</span
				>
			{/each}
		</div>

		<div class="cards pointer-events-none absolute inset-0 z-[2] max-[1099px]:hidden">
			{#each REGIONS as r (r.id)}
				<div
					class={[
						'card-slot pointer-events-auto absolute w-[19.5%] -translate-y-1/2',
						r.side === 'left' ? 'left-0' : 'right-0'
					]}
					style="top: {r.anchorY}%"
				>
					{@render card(r, 'd')}
				</div>
			{/each}
		</div>

		<svg
			class="leads pointer-events-none absolute inset-0 h-full w-full overflow-visible"
			bind:this={leadsEl}
			aria-hidden="true"
		></svg>
	</div>

	<div
		class="legend mt-4 hidden max-[1099px]:relative max-[1099px]:left-1/2 max-[1099px]:block max-[1099px]:w-screen max-[1099px]:-translate-x-1/2"
	>
		<Carousel.Root
			opts={{ align: 'center', containScroll: false }}
			setApi={(api) => (deckApi = api)}
		>
			<Carousel.Content class="-ms-3 pt-1 pb-3">
				{#each REGIONS as r (r.id)}
					<Carousel.Item class="flex basis-[min(300px,82%)] ps-3">
						{@render card(r, 'm')}
					</Carousel.Item>
				{/each}
			</Carousel.Content>
		</Carousel.Root>

		<button
			type="button"
			class={[
				'plate-exit mx-auto mt-1 flex items-center gap-1.5 cursor-pointer appearance-none border-0 bg-ink px-2.5 py-1.5 text-xs leading-none font-bold tracking-[0.08em] text-paper',
				!dimming && 'invisible'
			]}
			onclick={exitSpotlight}
		>
			<HugeiconsIcon icon={Cancel01Icon} size={13} strokeWidth={2.5} aria-hidden="true" />
			SHOW ALL
		</button>
	</div>
</figure>

<style>
	.leads :global(g.casing g.annotation path) {
		fill: none;
		stroke: var(--paper);
		stroke-width: 5;
		stroke-linecap: round;
	}
	.leads :global(g.ink g.annotation path) {
		fill: none;
		stroke: var(--ink);
		stroke-width: 1.5;
		transition: stroke 0.18s ease;
	}
	.leads :global(g.ink g.annotation.hot path) {
		stroke: var(--focus);
		stroke-width: 2;
	}
	.specimen.dimming .leads :global(g.ink g.annotation:not(.hot):not(.span) path) {
		stroke: var(--color-steel-300);
	}
	.leads :global(g.ink g.annotation.span path) {
		stroke: var(--ink);
		opacity: 0.55;
	}
	.leads :global(g.ink g.annotation.span .note-line) {
		display: none;
	}
	.leads :global(g.ink g.annotation.span .annotation-note-label) {
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.1em;
		fill: color-mix(in srgb, var(--ink) 62%, var(--paper));
	}
	.leads :global(.span-ticks) {
		stroke: var(--ink);
		stroke-width: 1.5;
		opacity: 0.55;
		fill: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.leads :global(g.annotation path) {
			transition: none;
		}
	}
</style>
