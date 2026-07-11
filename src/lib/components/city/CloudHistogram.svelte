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

	// Headroom above the tallest cloud: the arc rail and floating tags live here.
	let TOP_PAD = $derived(narrow ? 44 : 56);

	// The sun that owns the clear end of the sky — disc plus eight pixel rays.
	const SUN = [
		'.......#.......',
		'...............',
		'..#.........#..',
		'.....#####.....',
		'....#######....',
		'...#########...',
		'...#########...',
		'#..#########..#',
		'...#########...',
		'...#########...',
		'....#######....',
		'.....#####.....',
		'..#.........#..',
		'...............',
		'.......#.......'
	];

	function todayVal(c: CityStats): number {
		for (let i = c.e.length - 1; i >= 0; i--) if (c.e[i] != null) return c.e[i] as number;
		return c.mean;
	}
	const valueFor = (c: CityStats, m: 'today' | 'overall') =>
		m === 'today' ? todayVal(c) : c.mean;

	// Every city, ascending by its value for a mode — ties broken by code so the
	// order never shuffles between renders.
	function sortedByValue(m: 'today' | 'overall'): [string, CityStats, number][] {
		return Object.entries(data.cities)
			.map(([code, c]) => [code, c, valueFor(c, m)] as [string, CityStats, number])
			.sort((a, b) => a[2] - b[2] || (a[0] < b[0] ? -1 : 1));
	}

	// The weather front: a sorted unit CDF drawn as a skyline. One cloud per city,
	// placed left → right by rank and lifted to its cover value — sparse puffs on
	// the clear left rising into a solid deck on the right. The distribution's
	// shape IS the picture, and a city's x position IS its rank. Slots are far
	// narrower than the sprites, so clouds overlap into a bank on purpose, and
	// draw() fills the area beneath the silhouette with cloud mass.
	let layout = $derived.by(() => {
		const height = narrow ? 320 : 400;
		const baseY = height - AXIS_H - cell;
		const bandH = baseY - TOP_PAD;
		const empty = {
			boxes: [] as Box[],
			crest: [] as Box[],
			height,
			live: [] as number[],
			ghost: [] as number[],
			lo: 0,
			span: 100,
			baseY,
			bandH
		};
		if (!width) return empty;
		const atlas = buildMarkAtlas(cell);
		const innerW = width - MARGIN_X * 2;
		const snap = (v: number) => Math.round(v / cell) * cell;

		const entries = sortedByValue(mode);
		const n = entries.length;
		if (!n) return empty;
		const live = entries.map((e) => e[2]);
		// The other mode's sorted curve, ghosted behind the live front so
		// today-vs-overall reads at a glance. Both are sorted, so the two
		// silhouettes compare directly even though city order differs.
		const ghost = sortedByValue(mode === 'today' ? 'overall' : 'today').map((e) => e[2]);

		// Shared y-scale across both modes, stretched to the data's actual range —
		// the front fills the band instead of hugging the middle of 0–100.
		const rawLo = Math.min(live[0], ghost[0] ?? live[0]);
		const rawHi = Math.max(live[n - 1], ghost[ghost.length - 1] ?? live[n - 1]);
		const pad = (rawHi - rawLo) * 0.06 || 1;
		const lo = Math.max(0, rawLo - pad);
		const span = Math.max(1, Math.min(100, rawHi + pad) - lo);

		const boxes: Box[] = entries.map(([code, c, val], i) => {
			const tier = Math.max(1, coverTier(val)) as 1 | 2 | 3 | 4;
			const sprite = atlas.get('low', tier, fnv1a(code) % MARK_VARIANTS);
			const w = sprite.wCells * cell;
			const h = sprite.hCells * cell;
			// ±1 cell of seeded jitter so the front reads as weather, not a staircase.
			const jitter = ((fnv1a(code + ':jy') % 3) - 1) * cell;
			return {
				code,
				name: c.name,
				mean: val,
				sprite,
				x: snap(MARGIN_X + (n > 1 ? (i / (n - 1)) * innerW : innerW / 2)),
				// The sprite's bottom rides the value line, so the varying cloud
				// bodies — not their centres — crest the bank's silhouette.
				y: snap(baseY - ((val - lo) / span) * bandH) - h / 2 + jitter,
				w,
				h
			};
		});

		// Drawing all 400+ sprites clumps them into noise. Cresting the bank with
		// a spaced-out sample keeps individual clouds legible; the mass fill below
		// stands in for everyone else, and every column stays hoverable.
		const spacing = narrow ? 22 : 36;
		const step = Math.max(1, Math.round(n / Math.max(1, innerW / spacing)));
		const crest = boxes.filter((_, i) => i % step === 0);

		return { boxes, crest, height, live, ghost, lo, span, baseY, bandH };
	});

	// Value → pixel y on the shared front scale; draw() and hit-testing agree.
	let yFor = $derived(
		(val: number) => layout.baseY - ((val - layout.lo) / layout.span) * layout.bandH
	);
	// Sample a sorted curve at a horizontal fraction of the band.
	const curveAt = (arr: number[], t: number) =>
		arr[Math.min(arr.length - 1, Math.max(0, Math.round(t * (arr.length - 1))))];

	// The sky-twin connector: a single arc soaring over the front, thrown from
	// one cloud to the other. A parabola fits the bank's swell where the old
	// tower-era elbow rails no longer do; its rise scales with the horizontal
	// distance, so near twins hop and far twins vault.
	let arc = $derived.by(() => {
		if (!twin || !width) return null;
		const a = layout.boxes.find((b) => b.code === selected);
		const b = layout.boxes.find((b) => b.code === twin.code);
		if (!a || !b || a.code === b.code) return null;
		const x0 = a.x;
		const y0 = a.y - a.h / 2 - cell * 2;
		const x1 = b.x;
		const y1 = b.y - b.h / 2 - cell * 2;
		const dx = x1 - x0;

		const rise = Math.min(narrow ? 56 : 96, Math.max(narrow ? 28 : 40, Math.abs(dx) * 0.22));
		const apexY = Math.max(cell * 3, Math.min(y0, y1) - rise);
		// Quadratic through the apex: the control point sits twice as high.
		const cy = 2 * apexY - (y0 + y1) / 2;
		const N = 32;
		const pts: [number, number][] = [];
		for (let i = 0; i <= N; i++) {
			const t = i / N;
			const u = 1 - t;
			pts.push([
				u * u * x0 + 2 * u * t * ((x0 + x1) / 2) + t * t * x1,
				u * u * y0 + 2 * u * t * cy + t * t * y1
			]);
		}
		return { pts, apexX: (x0 + x1) / 2, apexY, twinBox: b };
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
	const DUR = 700; // per-cloud travel
	const SPREAD = 200; // gentle ripple, first cloud to last
	// Elapsed ms of the current glide (Infinity when settled) — draw() uses it to
	// lerp the bank's fill silhouette on the same per-column clock as the sprites.
	let animT = Infinity;
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
			animT = Infinity;
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
		const total = DUR + SPREAD;
		moving = true;
		const t0 = performance.now();
		const tick = (t: number) => {
			const el = t - t0;
			animT = el;
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
				animT = Infinity;
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

		const lv = layout.live;
		const gv = layout.ghost;
		const innerW = Math.max(1, width - MARGIN_X * 2);

		// A pixel sun keeps the clear corner company — chunky 2-cell blocks, gold.
		if (lv.length > 1) {
			const su = cell * 2;
			const sx0 = Math.round((MARGIN_X + innerW * 0.06) / su) * su;
			const sy0 = Math.round((TOP_PAD + layout.bandH * 0.08) / su) * su;
			ctx.fillStyle = UI.sunGold;
			for (let r = 0; r < SUN.length; r++)
				for (let c = 0; c < SUN[r].length; c++)
					if (SUN[r][c] === '#') ctx.fillRect(sx0 + c * su, sy0 + r * su, su, su);
		}

		// The bank itself: a soft body under a bright, scalloped crest. Seeded puff
		// domes billow the silhouette so it reads as cloud, not as a plotted line.
		// During a mode flip the silhouette lerps from the old curve (the ghost) to
		// the live one on the same per-column clock as the gliding sprites.
		if (lv.length > 1) {
			const g0 = Math.ceil(MARGIN_X / cell);
			const g1 = Math.floor((width - MARGIN_X) / cell);
			const gyBase = Math.floor(layout.baseY / cell);
			const settling = animT < DUR + SPREAD && gv.length > 1;
			const PW = narrow ? 9 : 8; // puff width, cells
			for (let gx = g0; gx <= g1; gx++) {
				const t = (gx * cell - MARGIN_X) / innerW;
				let yTop = yFor(curveAt(lv, t));
				if (settling) {
					const p = easeOut(Math.min(1, Math.max(0, (animT - t * SPREAD) / DUR)));
					const yOld = yFor(curveAt(gv, t));
					yTop = yOld + (yTop - yOld) * p;
				}
				// Billow: each puff-wide segment domes up by a seeded 1–3 cells.
				const seg = Math.floor(gx / PW);
				const amp = (1 + (fnv1a(`puff:${seg}`) % 3)) * cell;
				yTop -= Math.sin(Math.PI * ((gx % PW) + 0.5) / PW) * amp;

				const gyTop = Math.min(gyBase, Math.round(yTop / cell));
				// Bright crest edge…
				ctx.fillStyle = 'rgba(255,255,255,0.92)';
				ctx.fillRect(gx * cell, gyTop * cell, cell, cell * Math.min(2, gyBase - gyTop + 1));
				// …a light dither just beneath it…
				ctx.fillStyle = 'rgba(255,255,255,0.3)';
				for (let gy = gyTop + 2; gy <= Math.min(gyBase, gyTop + 6); gy++) {
					if ((gx + gy) % 2 === 0) ctx.fillRect(gx * cell, gy * cell, cell, cell);
				}
				// …and a quiet translucent body down to the ground.
				if (gyBase > gyTop + 1) {
					ctx.fillStyle = 'rgba(255,255,255,0.14)';
					ctx.fillRect(gx * cell, (gyTop + 2) * cell, cell, (gyBase - gyTop - 1) * cell);
				}
			}
		}

		// Ghost front: the OTHER mode's sorted curve as stitched dashes (2 on,
		// 2 off), labelled at its far end in the DOM — white out in the open sky,
		// navy where it dips inside the bank.
		if (gv.length > 1) {
			const g0 = Math.round(MARGIN_X / cell);
			const g1 = Math.round((width - MARGIN_X) / cell);
			for (let gx = g0; gx <= g1; gx++) {
				if ((gx & 3) >= 2) continue;
				const t = (gx * cell - MARGIN_X) / innerW;
				const yG = yFor(curveAt(gv, t));
				const inside = lv.length > 1 && yG > yFor(curveAt(lv, t));
				ctx.fillStyle = inside ? 'rgba(11,29,58,0.45)' : 'rgba(255,255,255,0.55)';
				ctx.fillRect(gx * cell, Math.round(yG / cell) * cell, cell, cell);
			}
		}

		// A spaced-out sample of city clouds crests the bank; the selected city,
		// its twin and the hovered city always ride on top so they stay legible.
		const sel = boxes.find((b) => b.code === selected) ?? null;
		for (const b of layout.crest) {
			const p = renderPos.get(b.code) ?? b;
			// p.w/p.h carry the mode's size (tweened mid-animation), so draw
			// explicitly sized rather than at the sprite's natural size.
			ctx.drawImage(b.sprite.canvas, Math.round(p.x - p.w / 2), Math.round(p.y - p.h / 2), p.w, p.h);
		}
		for (const b of [hovered, arc?.twinBox, sel]) {
			if (!b) continue;
			const p = renderPos.get(b.code) ?? b;
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
		const { boxes, live } = layout;
		if (!boxes.length || !live.length) return null;
		// x IS rank: any point on the bank maps straight to the city holding that
		// column, so the whole mass is hoverable — not just the crest sprites.
		const innerW = Math.max(1, width - MARGIN_X * 2);
		const t = Math.min(1, Math.max(0, (x - MARGIN_X) / innerW));
		const idx = Math.min(boxes.length - 1, Math.max(0, Math.round(t * (boxes.length - 1))));
		const crestY = yFor(curveAt(live, t));
		// Generous reach above the crest (sprites poke past it), hard stop below
		// the axis line.
		if (y < crestY - 36 || y > layout.baseY + cell) return null;
		return boxes[idx];
	}

	let selectedBox = $derived(layout.boxes.find((b) => b.code === selected) ?? null);
	let twinName = $derived(twin ? (data.cities[twin.code]?.name ?? null) : null);
	// Keep floating tags inside the canvas on narrow screens.
	let clampPad = $derived(narrow ? 54 : 70);

	// The dotted line is the other mode's front — name it, or it's a riddle.
	let ghostLabel = $derived(mode === 'today' ? 'overall' : 'today');

	// A label for each front, sitting on its own line near the middle of the chart.
	// The live bank is solid, the ghost is dashed — the marker glyph says which.
	// Both curves crest together at the right edge, so we tag them mid-chart where
	// they diverge, at slightly different x so the two labels never collide.
	let endLabels = $derived.by(() => {
		const lv = layout.live;
		const gv = layout.ghost;
		if (lv.length < 2) return [] as { key: string; label: string; x: number; y: number; solid: boolean }[];
		const innerW = Math.max(1, width - MARGIN_X * 2);
		const at = (arr: number[], t: number) => ({ x: MARGIN_X + t * innerW, y: yFor(curveAt(arr, t)) });
		const items = [{ key: 'live', label: mode, solid: true, ...at(lv, 0.42) }];
		if (gv.length > 1) items.push({ key: 'ghost', label: ghostLabel, solid: false, ...at(gv, 0.6) });
		return items;
	});

	let coverLabel = $derived(mode === 'today' ? "today's cloud cover" : 'long-term mean cloud cover');
	let ariaLabel = $derived(
		`Weather front of ${layout.boxes.length} cities sorted by ${coverLabel}, ` +
			`rising from clear on the left to overcast on the right, one cloud per city. ` +
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

	<!-- One label per front, sitting on its own line near the middle of the chart.
		The live front reads white + bold; the ghost reads in the dashed line's
		lighter tone and regular weight — weight and color do the work of a marker. -->
	{#each endLabels as l (l.key)}
		<span
			class="text-shadow-sky pointer-events-none absolute z-10 -translate-x-1/2 text-sm tracking-[0.14em] whitespace-nowrap text-white uppercase {l.solid
				? 'font-bold'
				: 'font-normal opacity-60'}"
			style="left: {l.x}px; top: {Math.max(4, l.y - 36)}px;"
		>
			{l.label}
		</span>
	{/each}

	{#if hovered && hovered.code !== selected}
		<div
			class="tag pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap text-white"
			style="left: {Math.min(Math.max(hovered.x, clampPad), width - clampPad)}px; top: {Math.max(
				2,
				hovered.y - hovered.h / 2 - 26
			)}px;"
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
			)}px; top: {Math.max(2, selectedBox.y - selectedBox.h / 2 - cell - 28)}px;"
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
			)}px; top: {Math.max(narrow ? 34 : 40, arc.apexY - 10)}px;"
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
