<script lang="ts">
	import { MediaQuery } from 'svelte/reactivity';
	import { select, curveLinear } from 'd3';
	import {
		annotation as makeAnnotation,
		annotationCalloutCurve,
		annotationXYThreshold
	} from 'd3-svg-annotation';
	import { MINIS, MINI_CLIPS, MINI_H, VB } from './meteogram-minis';
	import AtlasWordmark from './AtlasWordmark.svelte';
	import * as Carousel from '$lib/components/ui/carousel/index.js';
	import type { CarouselAPI } from '$lib/components/ui/carousel/context.js';

	type Rect = { x: number; y: number; w: number; h: number }; // % of the full image
	type Region = {
		id: string;
		n: number;
		title: string;
		note: string;
		rect: Rect; // panel bounds — marquee + hotspot
		mark: { x: number; y: number }; // numbered chip, % of the image (hand-placed)
		side: 'left' | 'right';
		anchorY: number; // card vertical center, % of image height
	};

	const SRC = '/method-meteogram.webp';

	// Panel frame lines measured off the 1100×1100 plate: plot area x=10.91→99.09,
	// horizontal rules at y = 6.36, 40, 47.73, 55.45, 63.18, 70.91, 78.64, 86.36, 96.36.
	const PLOT_X = 10.91;
	const PLOT_W = 88.18;

	const REGIONS: Region[] = [
		{
			id: 'upper-air',
			n: 1,
			side: 'left',
			anchorY: 12,
			title: 'UPPER AIR',
			note: 'A vertical slice of the sky up to about 5 km — barbs for wind, green shading for moist air, lines for temperature aloft.',
			rect: { x: PLOT_X, y: 6.36, w: PLOT_W, h: 33.64 },
			mark: { x: 15, y: 19.5 }
		},
		{
			id: 'pressure',
			n: 2,
			side: 'right',
			anchorY: 11,
			title: 'PRESSURE & THICKNESS',
			note: 'Air pressure at sea level, with a second line that tracks how warm the whole air column is.',
			rect: { x: PLOT_X, y: 40, w: PLOT_W, h: 7.73 },
			mark: { x: 95.5, y: 44.2 }
		},
		{
			id: 'instability',
			n: 3,
			side: 'left',
			anchorY: 43.5,
			title: 'INSTABILITY',
			note: 'How primed the air is to build storms: bars are storm fuel (CAPE), the line is the lifted index.',
			rect: { x: PLOT_X, y: 47.73, w: PLOT_W, h: 7.72 },
			mark: { x: 14, y: 51.8 }
		},
		{
			id: 'wind',
			n: 4,
			side: 'right',
			anchorY: 37.5,
			title: 'SURFACE WIND',
			note: 'Wind just above the ground: steady speed below, gusts on top, barbs for direction.',
			rect: { x: PLOT_X, y: 55.45, w: PLOT_W, h: 7.73 },
			mark: { x: 96.2, y: 59.4 }
		},
		{
			id: 'temperature',
			n: 5,
			side: 'left',
			anchorY: 68.5,
			title: 'TEMPERATURE',
			note: 'The day-night swing of air temperature, with whiskers marking each 3-hour high and low.',
			rect: { x: PLOT_X, y: 63.18, w: PLOT_W, h: 7.73 },
			mark: { x: 14.6, y: 66.9 }
		},
		{
			id: 'humidity',
			n: 6,
			side: 'right',
			anchorY: 63,
			title: 'HUMIDITY',
			note: 'How damp the air is — near-saturated overnight, drying out through the afternoon.',
			rect: { x: PLOT_X, y: 70.91, w: PLOT_W, h: 7.73 },
			mark: { x: 95.2, y: 74.9 }
		},
		{
			id: 'cloud',
			n: 7,
			side: 'right',
			anchorY: 91.5,
			title: 'CLOUD COVER',
			note: 'How much of the sky is covered, split into high, middle and low decks. The one panel this site reads.',
			rect: { x: PLOT_X, y: 78.64, w: PLOT_W, h: 7.72 },
			mark: { x: 95.8, y: 82.4 }
		},
		{
			id: 'precip',
			n: 8,
			side: 'left',
			anchorY: 92.5,
			title: 'PRECIPITATION',
			note: 'Rain expected in each 3-hour window — green for the total, red for the thunderstorm share.',
			rect: { x: PLOT_X, y: 86.36, w: PLOT_W, h: 10 },
			mark: { x: 14, y: 91.5 }
		}
	];

	const narrow = new MediaQuery('(max-width: 1099px)'); // must match the CSS breakpoint

	let hovered = $state<string | null>(null);
	let pinned = $state<string | null>(null);
	let swipeActive = $state<string | null>(null); // narrow layouts: card snapped in the deck
	let deckDismissed = $state(false); // narrow layouts: spotlight closed to view the plate plain
	const active = $derived(
		pinned ?? hovered ?? (narrow.current && !deckDismissed ? swipeActive : null)
	);
	// At rest the wide plate shows the cloud-panel callout (the panel the pipeline
	// reads); narrow layouts rest with no callout so the plate reads unobstructed.
	const shown = $derived(active ?? (narrow.current ? null : 'cloud'));
	const dimming = $derived(active !== null);
	const cur = $derived(REGIONS.find((r) => r.id === shown) ?? REGIONS[6]);

	let root: HTMLElement | undefined = $state();

	// Atlas x-coordinates: grid columns are 19.5% | 56% | 19.5% with 2.5% gaps,
	// so the image spans [22, 78] of the atlas width.
	const IMG_L = 22;
	const IMG_W = 56;
	const CARD_L = 19.5;
	const CARD_R = 80.5;

	// Leader lines: d3-annotation connectors in atlas pixel space. Every line
	// leaves the chip horizontally from its side-edge center, runs its vertical
	// in the clean gutter between plate and cards, takes one 45° elbow into the
	// card's row, and enters the card flat. Drawn twice — paper casing under ink
	// — so the line stays legible over the busy plate.
	let aw = $state(0);
	let ah = $state(0);
	let leadsEl: SVGSVGElement | undefined = $state();

	$effect(() => {
		const svg = leadsEl;
		if (!svg || !aw || !ah || narrow.current) return;
		const STUB = 12; // flat entry into the card
		const ELBOW = 14; // 45° segment size
		const specs = REGIONS.map((r) => {
			const dir = r.side === 'left' ? -1 : 1;
			// start at the chip's center — the chip paints above, so the line tucks under it
			const sx = ((IMG_L + (r.mark.x * IMG_W) / 100) / 100) * aw;
			const sy = (r.mark.y / 100) * ah;
			const ex = ((r.side === 'left' ? CARD_L : CARD_R) / 100) * aw;
			const ey = (r.anchorY / 100) * ah;
			const bendX = ex - dir * (STUB + ELBOW); // gutter, just off the card edge
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
		// Time-span annotation under the plate: the whole strip is one 10-day run.
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
			note: { label: 'ONE PLATE = A 10-DAY FORECAST, EVERY 3 HOURS', align: 'middle', wrap: 600 }
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
			.call(makeAnnotation().type(annotationCalloutCurve).annotations([...specs, span]));
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
		// On narrow layouts the cards live in the deck below — swipe it to the tapped panel.
		if (pinned === id && window.matchMedia('(max-width: 1099px)').matches) {
			deckDismissed = false;
			deckScrollTo(id);
		}
	}

	// Deck cards don't pin: clicking a side card slides it to the center. The
	// highlight moves right away — waiting for Embla's 'select' would flash the
	// old card while the scroll is still settling.
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

	// Swiping the deck sweeps the spotlight across the plate above. Embla fires
	// 'select' mid-drag as the target snap changes, so the sweep tracks the finger.
	let deckApi = $state<CarouselAPI>();

	$effect(() => {
		const api = deckApi;
		if (!api) return;
		const onSelect = () => {
			swipeActive = REGIONS[api.selectedScrollSnap()]?.id ?? null;
			deckDismissed = false;
		};
		onSelect(); // the snapped slide is highlighted from the start
		api.on('select', onSelect);
		return () => {
			api.off('select', onSelect);
		};
	});

	// ---- Loupe (narrow layouts): a magnified strip of the spotlighted panel ----
	// The same webp, cropped to the region's rect with background-position math.
	// Zoom fills the strip height but never exceeds the plate's native pixels —
	// past 1:1 there is nothing left to resolve, only blur.
	const LOUPE_H = 200; // strip content height, px
	const PLATE_PX = 1100; // native plate resolution
	let loupeEl: HTMLElement | undefined = $state();
	const loupeZoom = $derived.by(() => {
		if (!aw) return 1;
		const fillH = (LOUPE_H * cur.rect.w) / (cur.rect.h * aw);
		const native = (PLATE_PX * cur.rect.w) / (100 * aw);
		return Math.min(fillH, native); // may dip below 1 — the panel then fits whole, no pan
	});

	const loupeCropStyle = $derived(
		`width:${loupeZoom * 100}%;` +
			`aspect-ratio:${cur.rect.w} / ${cur.rect.h};` +
			`background-image:url(${SRC});` +
			`background-size:${10000 / cur.rect.w}% auto;` +
			`background-position:${(cur.rect.x / (100 - cur.rect.w)) * 100}% ${(cur.rect.y / (100 - cur.rect.h)) * 100}%`
	);

	$effect(() => {
		void shown; // the pan restarts at Day 0 whenever the spotlight moves
		if (loupeEl) loupeEl.scrollLeft = 0;
	});

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

{#snippet mini(id: string, ctx: string)}
	<svg
		class="mini"
		viewBox="0 0 {VB.w} {MINI_H[id] ?? VB.h}"
		style="aspect-ratio: {VB.w} / {MINI_H[id] ?? VB.h}"
		preserveAspectRatio="none"
		aria-hidden="true"
	>
		{#if MINI_CLIPS[id]}
			<defs>
				<clipPath id="mini-clip-{ctx}-{id}"><path d={MINI_CLIPS[id]} /></clipPath>
			</defs>
		{/if}
		{#each MINIS[id] as el, i (i)}
			{#if el.t === 'path'}
				<path
					d={el.d}
					fill={el.fill ?? 'none'}
					stroke={el.stroke}
					stroke-width={el.sw}
					stroke-dasharray={el.dash}
					opacity={el.o}
					clip-path={el.clip ? `url(#mini-clip-${ctx}-${id})` : undefined}
				/>
			{:else if el.t === 'rect'}
				<rect
					x={el.x}
					y={el.y}
					width={el.w}
					height={el.h}
					fill={el.fill}
					opacity={el.o}
					clip-path={el.clip ? `url(#mini-clip-${ctx}-${id})` : undefined}
				/>
			{:else}
				<circle cx={el.cx} cy={el.cy} r={el.r} fill={el.fill} stroke={el.stroke} stroke-width={el.sw} />
			{/if}
		{/each}
	</svg>
{/snippet}

{#snippet card(r: Region, ctx: string)}
	<button
		type="button"
		class="card"
		class:active={shown === r.id}
		data-card={r.n}
		aria-pressed={pinned === r.id}
		onpointerenter={() => ctx === 'd' && (hovered = r.id)}
		onpointerleave={() => ctx === 'd' && (hovered = null)}
		onfocus={() => ctx === 'd' && (hovered = r.id)}
		onblur={() => ctx === 'd' && (hovered = null)}
		onclick={() => cardClick(r.id, ctx)}
		onkeydown={(e) => onCardKeydown(e, r.n)}
	>
		<span class="card-head">
			<span class="marker inline">{r.n}</span>
			<span class="card-title">{r.title}</span>
		</span>
		<span class="card-note">{r.note}</span>
		{#if r.id === 'cloud'}
			<span class="card-day0">
				<span class="day0-chip">DAY 0</span>
				the first eight 3-hour steps — the slice the pipeline keeps.
			</span>
		{/if}
		{@render mini(r.id, ctx)}
	</button>
{/snippet}

<svelte:window onkeydown={onWindowKeydown} onpointerdown={onWindowPointerdown} />

<!-- <AtlasWordmark /> -->

<figure class="specimen" class:dimming bind:this={root}>
	<div class="atlas" bind:clientWidth={aw} bind:clientHeight={ah}>
		<div class="mount">
			<img
				class="plate"
				src={SRC}
				alt="Sample IMD GFS meteogram for Bangalore: eight stacked forecast panels, described in the numbered notes."
			/>
			{#each REGIONS as r (r.id)}
				<button
					type="button"
					class="hotspot"
					tabindex="-1"
					aria-hidden="true"
					style="left:{r.rect.x}%; top:{r.rect.y}%; width:{r.rect.w}%; height:{r.rect.h}%"
					onpointerenter={() => (hovered = r.id)}
					onpointerleave={() => (hovered = null)}
					onclick={() => tapRegion(r.id)}
				></button>
			{/each}
			<div
				class="marquee"
				class:dim={dimming}
				class:off={shown === null}
				style="left:{cur.rect.x}%; top:{cur.rect.y}%; width:{cur.rect.w}%; height:{cur.rect.h}%"
				aria-hidden="true"
			></div>
			{#each REGIONS as r (r.id)}
				<span
					class="marker on-plate"
					class:hot={shown === r.id}
					style="left:{r.mark.x}%; top:{r.mark.y}%"
					aria-hidden="true">{r.n}</span
				>
			{/each}
		</div>

		<div class="cards">
			{#each REGIONS as r (r.id)}
				<div class="card-slot {r.side}" style="top: {r.anchorY}%">
					{@render card(r, 'd')}
				</div>
			{/each}
		</div>

		<svg class="leads" bind:this={leadsEl} aria-hidden="true"></svg>
	</div>

	{#if narrow.current}
		<div class="loupe" class:open={active !== null} aria-hidden="true">
			<div class="loupe-frame">
				<div class="loupe-scroll" bind:this={loupeEl}>
					<div class="loupe-crop" style={loupeCropStyle}></div>
				</div>
			</div>
		</div>
	{/if}

	<div class="legend">
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
		<!-- Hidden, not removed, when idle — the deck below must not jump under the tap. -->
		<button type="button" class="plate-exit" class:off={!dimming} onclick={exitSpotlight}>
			✕ SHOW ALL
		</button>
	</div>

</figure>

<style>
	/* The wordmark above is part of the same plate — keep them close. */
	.specimen {
		margin: 1.5rem auto 5rem;
	}

	/* ---- Desktop atlas grid: cards | plate | cards, one shared %-space ---- */
	.atlas {
		position: relative;
		left: 50%;
		transform: translateX(-50%);
		width: min(100vw - 48px, 1380px);
		display: grid;
		grid-template-columns: 19.5% 56% 19.5%;
		column-gap: 2.5%;
	}
	.cards {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 2; /* cards paint over the leader lines */
	}
	.card-slot {
		position: absolute;
		width: 19.5%;
		transform: translateY(-50%);
		pointer-events: auto;
	}
	.card-slot.left {
		left: 0;
	}
	.card-slot.right {
		right: 0;
	}

	.mount {
		grid-column: 2;
		position: relative;
		border: 2px solid var(--ink);
		box-shadow: 6px 6px 0 var(--cloud-block);
		background: #fff;
		line-height: 0;
		overflow: hidden; /* clips the marquee's spotlight shadow */
	}
	.plate {
		width: 100%;
		height: auto;
		display: block;
	}

	.hotspot {
		position: absolute;
		padding: 0;
		border: 0;
		background: transparent;
		cursor: pointer;
		appearance: none;
	}

	/* ---- Spotlight marquee: one element that morphs between panels ---- */
	.marquee {
		position: absolute;
		border: 2px solid var(--focus);
		pointer-events: none;
		transition:
			left 0.18s ease,
			top 0.18s ease,
			width 0.18s ease,
			height 0.18s ease,
			box-shadow 0.18s ease;
	}
	.marquee.dim {
		box-shadow: 0 0 0 9999px color-mix(in srgb, var(--paper) 80%, transparent);
	}
	.marquee.off {
		display: none;
	}

	/* ---- Spotlight exit (narrow layouts): clears the callout to read the plate plain ---- */
	.plate-exit {
		display: block;
		margin: 4px auto 0;
		padding: 6px 10px;
		border: 0;
		appearance: none;
		cursor: pointer;
		background: var(--ink);
		color: var(--paper);
		font-family: var(--font-display);
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.08em;
		line-height: 1;
	}
	.plate-exit.off {
		visibility: hidden;
	}

	/* ---- Numbered markers, hand-placed on the plate ---- */
	.marker {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 19px;
		height: 19px;
		background: var(--ink);
		color: var(--paper);
		font-family: var(--font-display);
		font-size: 12px;
		font-weight: 700;
		line-height: 1;
	}
	.marker.on-plate {
		position: absolute;
		transform: translate(-50%, -50%);
		pointer-events: none;
		box-shadow: 0 0 0 2px var(--paper);
		z-index: 2; /* chips sit on top of the leader lines */
		transition:
			background 0.18s ease,
			color 0.18s ease;
	}
	.marker.on-plate.hot {
		background: var(--focus);
		color: var(--ink);
	}
	/* Muting is a color shift, never translucency — overlaps stay clean. */
	.specimen.dimming .marker.on-plate:not(.hot) {
		background: #aeb6c4;
		color: var(--paper);
	}
	.marker.inline {
		flex: none;
	}

	/* ---- Leader lines: straight connectors with a paper casing ---- */
	.leads {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		overflow: visible;
	}
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
		stroke: #c5cbd6;
	}
	/* Time-span annotation under the plate */
	.leads :global(g.ink g.annotation.span path) {
		stroke: var(--ink);
		opacity: 0.55;
	}
	.leads :global(g.ink g.annotation.span .note-line) {
		display: none;
	}
	.leads :global(g.ink g.annotation.span .annotation-note-label) {
		font-family: var(--font-display);
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

	/* ---- Annotation cards ---- */
	.card {
		display: flex;
		flex-direction: column;
		gap: 6px;
		width: 100%;
		padding: 8px 10px 10px;
		text-align: left;
		background: var(--paper);
		border: 2px solid transparent;
		cursor: pointer;
		appearance: none;
		font: inherit;
		color: inherit;
		transition:
			box-shadow 0.18s ease,
			border-color 0.18s ease;
	}
	.card.active {
		box-shadow: 4px 4px 0 var(--focus);
		border: 2px solid var(--ink);
	}
	/* Muted cards fade by color, not opacity — they stay opaque over the lines. */
	.specimen.dimming .card:not(.active) {
		border-color: transparent;
	}
	.specimen.dimming .card:not(.active) .card-title {
		color: #8a93a6;
	}
	.specimen.dimming .card:not(.active) .card-note,
	.specimen.dimming .card:not(.active) .card-day0 {
		color: #a4adbe;
	}
	.specimen.dimming .card:not(.active) .marker.inline {
		background: #aeb6c4;
	}
	.specimen.dimming .card:not(.active) .day0-chip {
		background: #aeb6c4;
	}
	.specimen.dimming .card:not(.active) .mini {
		filter: grayscale(1);
		opacity: 0.55; /* sits on the card's solid paper, so no see-through */
		border-color: #b9c2d0;
	}
	.card-head {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.card-title {
		font-family: var(--font-display);
		font-size: 13px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink);
	}
	.card-note {
		font-size: 13px;
		line-height: 1.5;
		color: var(--muted-foreground);
		text-wrap: pretty;
	}
	.card-day0 {
		display: block;
		font-size: 12px;
		line-height: 1.5;
		color: var(--muted-foreground);
	}
	.day0-chip {
		display: inline-block;
		padding: 0 5px 1px;
		margin-right: 4px;
		background: var(--ink);
		color: var(--paper);
		font-family: var(--font-display);
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.08em;
		line-height: 1.4;
		vertical-align: 1px;
	}

	/* ---- Mini-diagram: a drawn, simplified echo of the panel ---- */
	.mini {
		display: block;
		width: 100%;
		border: 1px solid var(--ink);
		background: #fff;
	}

	/* ---- Caption ---- */
	.plate-caption {
		margin-top: 64px;
		text-align: center;
		font-family: var(--font-display);
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.14em;
		color: var(--muted-foreground);
	}

	/* ---- Loupe (narrow layouts): magnified strip of the spotlighted panel ---- */
	.loupe {
		height: 0;
		overflow: hidden;
		transition: height 0.25s ease;
		/* mirror the narrow .atlas so the zoom math (based on its width) holds */
		max-width: 640px;
		margin: 0 auto;
	}
	.loupe.open {
		height: 216px; /* 12px gap + strip + 4px border — fixed so the deck below never jumps */
	}
	.loupe-frame {
		margin-top: 12px;
		height: 204px;
		border: 2px solid var(--ink);
		background: #fff;
	}
	.loupe-scroll {
		display: flex;
		height: 100%;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.loupe-scroll::-webkit-scrollbar {
		display: none;
	}
	.loupe-crop {
		flex: none;
		/* auto margins letterbox short panels and center narrow ones, but
		   collapse to 0 when the crop overflows — unlike justify-content:center
		   they never push content out of scroll reach */
		margin: auto;
		background-repeat: no-repeat;
	}

	/* ---- Legend deck (narrow layouts): Embla carousel, swipe to sweep the spotlight ---- */
	.legend {
		display: none;
		margin: 16px 0 0;
	}
	/* Slides stretch to match the tallest card; the chart absorbs the leftover height. */
	.legend .card .mini {
		flex-grow: 1;
	}

	@media (max-width: 1099px) {
		.cards,
		.leads {
			display: none;
		}
		.atlas {
			display: block;
			left: auto;
			transform: none;
			width: 100%;
			max-width: 640px;
			margin: 0 auto;
		}
		.legend {
			display: block;
			position: relative;
			left: 50%;
			transform: translateX(-50%);
			width: 100vw; /* full-bleed swipe lane */
		}
		/* Without leader lines or side cards the numbers key nothing — hide them. */
		.marker.on-plate,
		.legend .marker.inline {
			display: none;
		}
		.plate-caption {
			margin-top: 12px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.marquee,
		.card,
		.marker.on-plate,
		.loupe,
		.leads :global(g.annotation path) {
			transition: none;
		}
	}
</style>
