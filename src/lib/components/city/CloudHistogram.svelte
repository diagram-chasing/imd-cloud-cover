<script lang="ts">
	import { untrack } from 'svelte';
	import type { CitiesRollup, CityStats, TwinRef } from '$lib/types';
	import { select, curveLinear } from 'd3';
	import { annotation as makeAnnotation, annotationCalloutCurve } from 'd3-svg-annotation';
	import { buildMarkAtlas, MARK_VARIANTS, type Sprite } from '$lib/map/sprites';
	import { fnv1a } from '$lib/map/hash';
	import { coverTier, SKY, UI } from '$lib/theme';

	interface Props {
		data: CitiesRollup;
		selected: string;
		/** The sky twin to draw the arc to, already resolved for the active mode. */
		twin?: TwinRef | null;
		/** 'overall' bins by the long-term mean; 'today' by the latest reading. */
		mode?: 'today' | 'overall';
		onselect?: (code: string) => void;
	}
	let { data, selected, twin = null, mode = 'overall', onselect }: Props = $props();

	interface Box {
		code: string;
		name: string;
		mean: number;
		sprite: Sprite;
		x: number; // center
		y: number;
		w: number;
		h: number;
	}

	let canvas = $state<HTMLCanvasElement>();
	let width = $state(0);
	let hovered = $state<Box | null>(null);

	const AXIS_H = 34;
	let narrow = $derived(width < 640);
	let cell = $derived(narrow ? 2 : 4);
	let MARGIN_X = $derived(narrow ? Math.max(10, width * 0.03) : Math.max(34, width * 0.05));

	interface Item {
		code: string;
		name: string;
		mean: number;
		sprite: Sprite;
		w: number;
		h: number;
	}
	type Shelf = { items: Item[]; w: number; h: number };

	// Bin every city into its column and pack each column into shelves, for a
	// given value-getter. Pulled out of `layout` so the height can be measured
	// against BOTH modes — toggling then reshuffles clouds without resizing.
	function shelveBy(
		valueOf: (c: CityStats) => number,
		atlas: ReturnType<typeof buildMarkAtlas>,
		cols: number,
		slotW: number,
		gap: number,
		sz: number
	): { shelvesPerBin: Shelf[][]; peak: number } {
		const binned: [string, CityStats][][] = Array.from({ length: cols }, () => []);
		for (const entry of Object.entries(data.cities)) {
			const col = Math.min(cols - 1, Math.floor((valueOf(entry[1]) / 100) * cols));
			binned[col].push(entry);
		}
		const shelvesPerBin = binned.map((bin) => {
			bin.sort((a, b) => (b[1].pop ?? 0) - (a[1].pop ?? 0));
			const shelves: Shelf[] = [];
			let shelf: Shelf = { items: [], w: 0, h: 0 };
			for (const [code, c] of bin) {
				const val = valueOf(c);
				const tier = Math.max(1, coverTier(val)) as 1 | 2 | 3 | 4;
				const sprite = atlas.get('low', tier, fnv1a(code) % MARK_VARIANTS);
				const w = sprite.wCells * cell * sz;
				const h = sprite.hCells * cell * sz;
				if (shelf.items.length && shelf.w + gap + w > slotW - gap) {
					shelves.push(shelf);
					shelf = { items: [], w: 0, h: 0 };
				}
				shelf.w += (shelf.items.length ? gap : 0) + w;
				shelf.h = Math.max(shelf.h, h);
				shelf.items.push({ code, name: c.name, mean: val, sprite, w, h });
			}
			if (shelf.items.length) shelves.push(shelf);
			return shelves;
		});
		const peak = Math.max(
			0,
			...shelvesPerBin.map((shelves) => shelves.reduce((acc, s) => acc + s.h + gap, 0))
		);
		return { shelvesPerBin, peak };
	}

	// Pack a mode's clouds so the tallest tower fits `usable`. Shrinking the
	// clouds packs more per row AND shortens each row, so tower height falls
	// roughly with the square of the scale — a couple of steps converge fast.
	function fitShelves(
		valueOf: (c: CityStats) => number,
		atlas: ReturnType<typeof buildMarkAtlas>,
		cols: number,
		slotW: number,
		gap: number,
		usable: number
	): { shelvesPerBin: Shelf[][]; peak: number; sz: number } {
		let sz = 1;
		let res = shelveBy(valueOf, atlas, cols, slotW, gap, sz);
		for (let i = 0; i < 6 && res.peak > usable; i++) {
			sz = Math.max(0.35, sz * Math.sqrt(usable / res.peak) * 0.98);
			res = shelveBy(valueOf, atlas, cols, slotW, gap, sz);
		}
		return { ...res, sz };
	}

	let layout = $derived.by(() => {
		if (!width) return { boxes: [] as Box[], height: 380 };
		const atlas = buildMarkAtlas(cell);
		const gap = cell;
		// Bins are fluid: the slot width comes from the available span, never the
		// other way round, so towers can't spill past the margins on any screen.
		const cols = width < 480 ? 8 : 10;
		const innerW = width - MARGIN_X * 2;
		const slotW = innerW / cols;
		const originX = MARGIN_X;

		// Height is fixed to the "overall" arrangement — the mode switch must not
		// resize the explorer.
		const overall = shelveBy((c) => c.mean, atlas, cols, slotW, gap, 1);
		const height = Math.max(narrow ? 320 : 380, overall.peak + AXIS_H + 80);
		const usable = height - AXIS_H - gap - 40;

		// "Today" bunches cities into a few columns; rather than let those towers
		// grow the canvas, the clouds shrink to fit the same band.
		const chosen =
			mode === 'today'
				? fitShelves(
						(c) => {
							for (let i = c.e.length - 1; i >= 0; i--)
								if (c.e[i] != null) return c.e[i] as number;
							return c.mean;
						},
						atlas,
						cols,
						slotW,
						gap,
						usable
					)
				: overall;
		const shelvesPerBin = chosen.shelvesPerBin;

		const boxes: Box[] = [];
		shelvesPerBin.forEach((shelves, col) => {
			const slotX = originX + col * slotW;
			let cursor = height - AXIS_H - gap;
			for (const s of shelves) {
				let x = slotX + (slotW - s.w) / 2;
				for (const item of s.items) {
					boxes.push({ ...item, x: x + item.w / 2, y: cursor - item.h / 2 });
					x += item.w + gap;
				}
				cursor -= s.h + gap;
			}
		});
		return { boxes, height };
	});

	// The sky-twin connector: elbowed like the meteogram atlas leads — vertical
	// rises, a horizontal rail, 45° bends. Those segments are pixel-native, so
	// the line rasterises crisply onto the cell grid. When the two clouds share
	// a column the route swings out through a side lane instead of collapsing
	// into a straight vertical line.
	let arc = $derived.by(() => {
		if (!twin || !width) return null;
		const a = layout.boxes.find((b) => b.code === selected);
		const b = layout.boxes.find((b) => b.code === twin.code);
		if (!a || !b || a.code === b.code) return null;
		const k = narrow ? 8 : 14; // 45° elbow size
		const x0 = a.x;
		const y0 = a.y - a.h / 2 - cell * 2;
		const x1 = b.x;
		const y1 = b.y - b.h / 2 - cell * 2;
		const dx = x1 - x0;

		let pts: [number, number][];
		let apexX: number;
		let railY: number;
		if (Math.abs(dx) >= 2 * k + 44) {
			// Up from the selected cloud, along a rail above both, down into the twin.
			railY = Math.max(40, Math.min(y0, y1) - (narrow ? 30 : 44));
			const dir = Math.sign(dx);
			pts = [
				[x0, y0],
				[x0, railY + k],
				[x0 + dir * k, railY],
				[x1 - dir * k, railY],
				[x1, railY + k],
				[x1, y1]
			];
			apexX = (x0 + x1) / 2;
		} else {
			// Same column: out to a side lane, down (or up) the lane, back in
			// along a low rail just above the twin's cloud.
			railY = Math.max(40, Math.min(y0, y1) - (3 * k + 14));
			const room = narrow ? 60 : 96;
			const side = Math.max(x0, x1) + room + 50 < width ? 1 : -1;
			const lane = (side > 0 ? Math.max(x0, x1) : Math.min(x0, x1)) + side * room;
			const lowY = y1 - k - 6;
			pts = [
				[x0, y0],
				[x0, railY + k],
				[x0 + side * k, railY],
				[lane - side * k, railY],
				[lane, railY + k],
				[lane, lowY - k],
				[lane - side * k, lowY],
				[x1 + side * k, lowY],
				[x1, lowY + k],
				[x1, y1]
			];
			apexX = (x0 + lane) / 2;
		}
		return { pts, apexX, apexY: railY, twinBox: b };
	});

	// d3-svg-annotation generates the connector path (hidden scaffold svg);
	// we then sample it back into cell coordinates and let the canvas draw it
	// as pixels, matching everything else in this sky.
	let arcSvg = $state<SVGSVGElement>();
	let arcCells = $state<[number, number][]>([]);
	$effect(() => {
		const svg = arcSvg;
		if (!svg) return;
		const sel = select(svg);
		sel.selectAll('*').remove();
		if (!arc) {
			arcCells = [];
			return;
		}
		const [sx, sy] = arc.pts[0];
		const [ex, ey] = arc.pts[arc.pts.length - 1];
		const spec = {
			x: sx,
			y: sy,
			dx: ex - sx,
			dy: ey - sy,
			disable: ['note', 'subject'],
			note: {},
			connector: {
				points: arc.pts.slice(1, -1).map(([px, py]) => [px - sx, py - sy]),
				curve: curveLinear
			}
		};
		sel.append('g').call(makeAnnotation().type(annotationCalloutCurve).annotations([spec]));
		const path =
			svg.querySelector<SVGPathElement>('.annotation-connector path') ??
			svg.querySelector<SVGPathElement>('path');
		if (!path) {
			arcCells = [];
			return;
		}
		const len = path.getTotalLength();
		const step = cell * 0.55;
		const cells: [number, number][] = [];
		let key = '';
		for (let d = 0; d <= len; d += step) {
			// Path coords are local to the annotation's translate(sx, sy) group.
			const p = path.getPointAtLength(d);
			const gx = Math.round((p.x + sx) / cell);
			const gy = Math.round((p.y + sy) / cell);
			const kk = `${gx}:${gy}`;
			if (kk !== key) {
				cells.push([gx, gy]);
				key = kk;
			}
		}
		arcCells = cells;
	});

	// Stitch-in: the line replays from the selected end whenever the pair changes,
	// and stays retracted while clouds are mid-flight so it can't draw across a
	// sky that hasn't settled — it stitches in once they land.
	let arcP = $state(1);
	$effect(() => {
		void arcCells;
		if (moving) {
			arcP = 0;
			return;
		}
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			arcP = 1;
			return;
		}
		arcP = 0;
		let raf = 0;
		const t0 = performance.now();
		const tick = (t: number) => {
			const p = Math.min(1, (t - t0) / 550);
			arcP = 1 - Math.pow(1 - p, 3);
			if (p < 1) raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	});

	// Animated cloud state, keyed by city code — centre and drawn size both tween
	// (clouds shrink/grow between modes). Not reactive: it's mutated frame-by-frame
	// inside the RAF loop below, and draw() reads it directly.
	type Frame = { x: number; y: number; w: number; h: number };
	let renderPos = new Map<string, Frame>();
	let prevMode = mode;
	let prevWidth = 0;
	let moveRaf = 0;
	// True while clouds are in flight — the sky-twin lead stays hidden until they land.
	let moving = $state(false);

	// Ease-out quart: leaves immediately (no perceived delay) and settles softly.
	const easeOut = (p: number) => 1 - Math.pow(1 - p, 4);

	// When the mode flips, each cloud glides from where it was to its new column;
	// resize (or first paint) just snaps, so dragging the window doesn't wobble.
	$effect(() => {
		const boxes = layout.boxes;
		const targets = new Map<string, Frame>(
			boxes.map((b) => [b.code, { x: b.x, y: b.y, w: b.w, h: b.h }])
		);
		const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		const modeChanged = mode !== prevMode;
		const snap = reduce || renderPos.size === 0 || width !== prevWidth || !modeChanged;
		prevMode = mode;
		prevWidth = width;

		cancelAnimationFrame(moveRaf);
		if (snap) {
			renderPos = targets;
			moving = false;
			// untrack: this effect must depend only on layout/mode/width, not on the
			// reactive state draw() reads (moving/arcP/…) — else writing `moving`
			// below would re-run it and cancel the animation before it starts.
			untrack(() => draw());
			return;
		}

		// Every cloud starts moving at once; a light stagger by target column just
		// adds a left → right ripple to the settle, not an upfront wait.
		const from = new Map<string, Frame>();
		for (const b of boxes) from.set(b.code, renderPos.get(b.code) ?? targets.get(b.code)!);
		const innerW = Math.max(1, width - MARGIN_X * 2);
		const DUR = 700; // per-cloud travel
		const SPREAD = 200; // gentle ripple, first cloud to last
		const total = DUR + SPREAD;
		moving = true;
		const t0 = performance.now();
		const tick = (t: number) => {
			const el = t - t0;
			for (const b of boxes) {
				const f = from.get(b.code)!;
				const tg = targets.get(b.code)!;
				const norm = Math.min(1, Math.max(0, (tg.x - MARGIN_X) / innerW));
				const p = Math.min(1, Math.max(0, (el - norm * SPREAD) / DUR));
				const e = easeOut(p);
				renderPos.set(b.code, {
					x: f.x + (tg.x - f.x) * e,
					y: f.y + (tg.y - f.y) * e,
					w: f.w + (tg.w - f.w) * e,
					h: f.h + (tg.h - f.h) * e
				});
			}
			if (el < total) {
				draw();
				moveRaf = requestAnimationFrame(tick);
			} else {
				// Landed: reveal the sky-twin lead so it stitches onto settled clouds.
				moving = false;
				draw();
			}
		};
		moveRaf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(moveRaf);
	});

	$effect(() => {
		draw();
	});

	function frame(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number, color: string) {
		const px = Math.max(2, cell);
		const fx = Math.round(cx - w / 2) - px;
		const fy = Math.round(cy - h / 2) - px;
		const fw = w + px * 2;
		const fh = h + px * 2;
		// Navy casing first so the frame reads over white cloud bodies too.
		ctx.fillStyle = 'rgba(11,29,58,0.5)';
		ctx.fillRect(fx - 1, fy - 1, fw + 2, px + 2);
		ctx.fillRect(fx - 1, fy + fh - px - 1, fw + 2, px + 2);
		ctx.fillRect(fx - 1, fy - 1, px + 2, fh + 2);
		ctx.fillRect(fx + fw - px - 1, fy - 1, px + 2, fh + 2);
		ctx.fillStyle = color;
		ctx.fillRect(fx, fy, fw, px);
		ctx.fillRect(fx, fy + fh - px, fw, px);
		ctx.fillRect(fx, fy, px, fh);
		ctx.fillRect(fx + fw - px, fy, px, fh);
	}

	function draw() {
		if (!canvas || !width) return;
		const { boxes, height } = layout;
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		canvas.width = Math.round(width * dpr);
		canvas.height = Math.round(height * dpr);
		const ctx = canvas.getContext('2d')!;
		ctx.scale(dpr, dpr);
		ctx.imageSmoothingEnabled = false;

		// Flat daylight blue — the map's own day sky.
		ctx.fillStyle = SKY.day.top;
		ctx.fillRect(0, 0, width, height);

		// Axis line along the bottom; the clouds rise off it.
		ctx.fillStyle = 'rgba(255,255,255,0.65)';
		ctx.fillRect(MARGIN_X, height - AXIS_H, width - MARGIN_X * 2, 2);

		let sel: Box | null = null;
		for (const b of boxes) {
			if (b.code === selected) sel = b;
			const p = renderPos.get(b.code) ?? b;
			// p.w/p.h carry the mode's size scale (tweened mid-animation), so draw
			// explicitly sized: natural in "overall", shrunk in denser "today".
			ctx.drawImage(b.sprite.canvas, Math.round(p.x - p.w / 2), Math.round(p.y - p.h / 2), p.w, p.h);
		}

		// Sky-twin lead: pixel cells sampled off the d3-annotation elbow path.
		// Stitched (2 on, 1 off), gold over a navy casing so it survives both
		// the open sky and the white cloud bodies it crosses.
		if (arcCells.length) {
			const n = Math.round(arcCells.length * arcP);
			ctx.fillStyle = 'rgba(11,29,58,0.5)';
			for (let i = 0; i < n; i++) {
				if (i % 3 === 2) continue;
				const [gx, gy] = arcCells[i];
				ctx.fillRect(gx * cell - 1, gy * cell - 1, cell + 2, cell + 2);
			}
			ctx.fillStyle = UI.sunGold;
			for (let i = 0; i < n; i++) {
				if (i % 3 === 2) continue;
				const [gx, gy] = arcCells[i];
				ctx.fillRect(gx * cell, gy * cell, cell, cell);
			}
		}

		// The twin's cloud gets a white frame (the lead lands on it) — held back
		// until the clouds settle, so it appears with the lead, not mid-flight.
		if (arc && !moving) {
			const p = renderPos.get(arc.twinBox.code) ?? arc.twinBox;
			frame(ctx, p.x, p.y, p.w, p.h, '#ffffff');
		}

		// Selected city: gold pixel frame.
		if (sel) {
			const p = renderPos.get(sel.code) ?? sel;
			frame(ctx, p.x, p.y, p.w, p.h, UI.sunGold);
		}
	}

	function boxAt(ev: MouseEvent): Box | null {
		const rect = canvas!.getBoundingClientRect();
		const x = ev.clientX - rect.left;
		const y = ev.clientY - rect.top;
		return (
			layout.boxes.find(
				(b) => Math.abs(x - b.x) <= b.w / 2 + cell && Math.abs(y - b.y) <= b.h / 2 + cell
			) ?? null
		);
	}

	let selectedBox = $derived(layout.boxes.find((b) => b.code === selected) ?? null);
	let twinName = $derived(twin ? (data.cities[twin.code]?.name ?? null) : null);
	// Keep floating tags inside the canvas on narrow screens.
	let clampPad = $derived(narrow ? 54 : 70);

	let coverLabel = $derived(mode === 'today' ? "today's cloud cover" : 'long-term mean cloud cover');
	let ariaLabel = $derived(
		`Histogram of ${layout.boxes.length} cities by ${coverLabel}, ` +
			`clear on the left to overcast on the right, one cloud per city. ` +
			`${selectedBox ? `${selectedBox.name} is highlighted. ` : ''}` +
			`${twinName ? `An arc links it to its sky twin, ${twinName}. ` : ''}` +
			`Use the city search in the title to choose a city.`
	);
</script>

<div class="histogram relative" bind:clientWidth={width}>
	<p class="sr-only">{ariaLabel}</p>
	<canvas
		bind:this={canvas}
		class="block w-full [image-rendering:pixelated]"
		style="height: {layout.height}px; cursor: {hovered ? 'pointer' : 'default'};"
		aria-hidden="true"
		onmousemove={(ev) => (hovered = boxAt(ev))}
		onmouseleave={() => (hovered = null)}
		onclick={(ev) => {
			const b = boxAt(ev);
			if (b) onselect?.(b.code);
		}}
	></canvas>

	<!-- Hidden scaffold: d3-svg-annotation renders the connector path here, and
		the effect above samples it into the pixel cells the canvas draws. -->
	<svg
		bind:this={arcSvg}
		class="pointer-events-none invisible absolute inset-0 h-full w-full overflow-visible"
		aria-hidden="true"
	></svg>

	{#if hovered && hovered.code !== selected}
		<div
			class="tag pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap text-white"
			style="left: {Math.min(Math.max(hovered.x, clampPad), width - clampPad)}px; top: {hovered.y -
				hovered.h / 2 -
				26}px;"
		>
			{hovered.name} · {Math.round(hovered.mean)}%
		</div>
	{/if}

	<!-- Selected city's tag floats above its gold frame. -->
	{#if selectedBox}
		<div
			class="tag pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap text-sun-gold"
			style="left: {Math.min(
				Math.max(selectedBox.x, clampPad),
				width - clampPad
			)}px; top: {selectedBox.y - selectedBox.h / 2 - cell - 28}px;"
		>
			{selectedBox.name}
		</div>
	{/if}

	<!-- Sky-twin tag rides the arc's apex: press it to fly to the twin. -->
	{#if arc && twin && twinName && !moving}
		<button
			class="tag twin-tag absolute z-10 -translate-x-1/2 -translate-y-full cursor-pointer text-center whitespace-nowrap text-white transition-colors duration-120 hover:text-sun-gold"
			style="left: {Math.min(
				Math.max(arc.apexX, clampPad + 30),
				width - clampPad - 30
			)}px; top: {arc.apexY - 10}px;"
			onclick={() => onselect?.(twin.code)}
		>
			<span class="block text-xs leading-none tracking-[0.16em] opacity-70">Most Like</span>
			<span class="mt-0.5 block text-sm leading-tight">
				<span class="border-b-2 border-sun-gold">{twinName}</span>
			</span>
		</button>
	{/if}

	<!-- Axis captions ride the bottom strip. -->
	<div
		class="pointer-events-none absolute inset-x-0 bottom-2 flex items-center justify-between text-xs font-bold tracking-[0.14em] text-white uppercase text-shadow-sky"
		style="padding-inline: {MARGIN_X}px;"
	>
		<span>← Clear</span>
		<span class="opacity-70 max-sm:hidden">{mode === 'today' ? "today's cloud cover" : 'mean cloud cover'}</span>
		<span>Overcast →</span>
	</div>
</div>

<style>
	/* Floating labels sit on a navy chip with a hard pixel drop — readable over
	   both the flat sky and the white cloud bodies. */
	.tag {
		padding: 4px 8px;
		background: color-mix(in srgb, var(--color-navy) 84%, transparent);
		box-shadow: 2px 2px 0 color-mix(in srgb, var(--color-navy) 35%, transparent);
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.08em;
		line-height: 1.15;
		text-transform: uppercase;
	}
</style>
