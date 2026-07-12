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
		twin?: TwinRef | null;
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

	let TOP_PAD = $derived(narrow ? 44 : 56);

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

	function sortedByValue(m: 'today' | 'overall'): [string, CityStats, number][] {
		return Object.entries(data.cities)
			.map(([code, c]) => [code, c, valueFor(c, m)] as [string, CityStats, number])
			.sort((a, b) => a[2] - b[2] || (a[0] < b[0] ? -1 : 1));
	}

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

		const ghost = sortedByValue(mode === 'today' ? 'overall' : 'today').map((e) => e[2]);


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
			const jitter = ((fnv1a(code + ':jy') % 3) - 1) * cell;
			return {
				code,
				name: c.name,
				mean: val,
				sprite,
				x: snap(MARGIN_X + (n > 1 ? (i / (n - 1)) * innerW : innerW / 2)),

				y: snap(baseY - ((val - lo) / span) * bandH) - h / 2 + jitter,
				w,
				h
			};
		});


		const spacing = narrow ? 22 : 36;
		const step = Math.max(1, Math.round(n / Math.max(1, innerW / spacing)));
		const crest = boxes.filter((_, i) => i % step === 0);

		return { boxes, crest, height, live, ghost, lo, span, baseY, bandH };
	});

	let yFor = $derived(
		(val: number) => layout.baseY - ((val - layout.lo) / layout.span) * layout.bandH
	);
	const curveAt = (arr: number[], t: number) =>
		arr[Math.min(arr.length - 1, Math.max(0, Math.round(t * (arr.length - 1))))];

	let arc = $derived.by(() => {
		if (!twin || !width) return null;
		const a = layout.boxes.find((b) => b.code === selected);
		const b = layout.boxes.find((b) => b.code === twin.code);
		if (!a || !b || a.code === b.code) return null;

		const x0 = a.x;
		const x1 = b.x;
		const dx = x1 - x0;
		const sgn = Math.sign(dx) || 1;

		const minTop = Math.min(a.y - a.h / 2, b.y - b.h / 2);
		const maxBot = Math.max(a.y + a.h / 2, b.y + b.h / 2);

		const rise = Math.min(narrow ? 56 : 96, Math.max(narrow ? 30 : 44, Math.abs(dx) * 0.22));
		const TOPMIN = cell * 3;
		const BOTMAX = layout.baseY - cell * 2;


		const aboveSlack = minTop - TOPMIN;
		const belowSlack = BOTMAX - maxBot;
		const under = belowSlack > aboveSlack;

		const gap = cell * 2;
		const y0 = under ? a.y + a.h / 2 + gap : a.y - a.h / 2 - gap;
		const y1 = under ? b.y + b.h / 2 + gap : b.y - b.h / 2 - gap;
		const railY = under ? Math.min(BOTMAX, maxBot + rise) : Math.max(TOPMIN, minTop - rise);

		const ELBOW = narrow ? 10 : 16;
		const k = Math.max(
			0,
			Math.min(ELBOW, Math.abs(dx) / 2, Math.abs(railY - y0), Math.abs(railY - y1))
		);
		const railBevel = under ? railY - k : railY + k;

		const pts: [number, number][] = [
			[x0, y0],
			[x0, railBevel],
			[x0 + sgn * k, railY],
			[x1 - sgn * k, railY],
			[x1, railBevel],
			[x1, y1]
		];
		return { pts, apexX: (x0 + x1) / 2, apexY: railY, under, twinBox: b };
	});

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

	type Frame = { x: number; y: number; w: number; h: number };
	let renderPos = new Map<string, Frame>();
	let prevMode = mode;
	let prevWidth = 0;
	let moveRaf = 0;
	const DUR = 700;
	const SPREAD = 200;
	let animT = Infinity;
	let moving = $state(false);

	const easeOut = (p: number) => 1 - Math.pow(1 - p, 4);

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
			untrack(() => draw());
			return;
		}

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

	// Dotted pixel leader from a top-row label down to its cloud. `pts` is an
	// axis-aligned polyline (an elbow); each dot gets a navy backing for contrast.
	function drawStem(ctx: CanvasRenderingContext2D, pts: [number, number][], color: string) {
		let idx = 0;
		for (let s = 0; s < pts.length - 1; s++) {
			const [x0, y0] = pts[s];
			const [x1, y1] = pts[s + 1];
			const steps = Math.round(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / cell);
			for (let k = 0; k <= steps; k++) {
				if (idx++ % 2 !== 0) continue;
				const t = steps ? k / steps : 0;
				const gx = Math.round((x0 + (x1 - x0) * t) / cell);
				const gy = Math.round((y0 + (y1 - y0) * t) / cell);
				ctx.fillStyle = 'rgba(11,29,58,0.4)';
				ctx.fillRect(gx * cell - 1, gy * cell - 1, cell + 2, cell + 2);
				ctx.fillStyle = color;
				ctx.fillRect(gx * cell, gy * cell, cell, cell);
			}
		}
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

		ctx.fillStyle = 'rgba(255,255,255,0.65)';
		ctx.fillRect(MARGIN_X, height - AXIS_H, width - MARGIN_X * 2, 2);

		const lv = layout.live;
		const gv = layout.ghost;
		const innerW = Math.max(1, width - MARGIN_X * 2);

		if (lv.length > 1) {
			const su = cell * 2;
			const sx0 = Math.round((MARGIN_X + innerW * 0.06) / su) * su;
			const sy0 = Math.round((TOP_PAD + layout.bandH * 0.08) / su) * su;
			ctx.fillStyle = UI.sunGold;
			for (let r = 0; r < SUN.length; r++)
				for (let c = 0; c < SUN[r].length; c++)
					if (SUN[r][c] === '#') ctx.fillRect(sx0 + c * su, sy0 + r * su, su, su);
		}


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
				const seg = Math.floor(gx / PW);
				const amp = (1 + (fnv1a(`puff:${seg}`) % 3)) * cell;
				yTop -= Math.sin(Math.PI * ((gx % PW) + 0.5) / PW) * amp;

				const gyTop = Math.min(gyBase, Math.round(yTop / cell));
				ctx.fillStyle = 'rgba(255,255,255,0.92)';
				ctx.fillRect(gx * cell, gyTop * cell, cell, cell * Math.min(2, gyBase - gyTop + 1));
				ctx.fillStyle = 'rgba(255,255,255,0.3)';
				for (let gy = gyTop + 2; gy <= Math.min(gyBase, gyTop + 6); gy++) {
					if ((gx + gy) % 2 === 0) ctx.fillRect(gx * cell, gy * cell, cell, cell);
				}
				if (gyBase > gyTop + 1) {
					ctx.fillStyle = 'rgba(255,255,255,0.14)';
					ctx.fillRect(gx * cell, (gyTop + 2) * cell, cell, (gyBase - gyTop - 1) * cell);
				}
			}
		}

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

		const sel = boxes.find((b) => b.code === selected) ?? null;
		for (const b of layout.crest) {
			const p = renderPos.get(b.code) ?? b;

			ctx.drawImage(b.sprite.canvas, Math.round(p.x - p.w / 2), Math.round(p.y - p.h / 2), p.w, p.h);
		}
		for (const b of [hovered, arc?.twinBox, sel]) {
			if (!b) continue;
			const p = renderPos.get(b.code) ?? b;
			ctx.drawImage(b.sprite.canvas, Math.round(p.x - p.w / 2), Math.round(p.y - p.h / 2), p.w, p.h);
		}


		// Narrow: the top-row labels + their stems carry the twin link, so skip the
		// cloud-to-cloud arc — two elbowed lines in one spot reads as clutter.
		if (!narrow && arcCells.length) {
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


		// Narrow: connect each top-row label back down to its cloud with a leader.
		if (narrow && !moving) {
			for (const l of labels) {
				if (l.anchorX == null || l.anchorY == null) continue;
				const lyBot = l.top + l.h;
				const rail = lyBot + cell * 2;
				drawStem(
					ctx,
					[
						[l.anchorX, l.anchorY - cell],
						[l.anchorX, rail],
						[l.x, rail],
						[l.x, lyBot + 1]
					],
					l.kind === 'sel' ? UI.sunGold : 'rgba(255,255,255,0.9)'
				);
			}
		}

		if (arc && !moving) {
			const p = renderPos.get(arc.twinBox.code) ?? arc.twinBox;
			frame(ctx, p.x, p.y, p.w, p.h, '#ffffff');
		}

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

		const innerW = Math.max(1, width - MARGIN_X * 2);
		const t = Math.min(1, Math.max(0, (x - MARGIN_X) / innerW));
		const idx = Math.min(boxes.length - 1, Math.max(0, Math.round(t * (boxes.length - 1))));
		const crestY = yFor(curveAt(live, t));

		if (y < crestY - 36 || y > layout.baseY + cell) return null;
		return boxes[idx];
	}

	let selectedBox = $derived(layout.boxes.find((b) => b.code === selected) ?? null);
	let twinName = $derived(twin ? (data.cities[twin.code]?.name ?? null) : null);
	let clampPad = $derived(narrow ? 54 : 70);

	// Keep any absolutely-positioned tag fully inside the plot: clamp its center by
	// its own half-width so a long city name (e.g. THIRUVANANTHAPURAM) can't spill
	// past the edge — which otherwise forces horizontal page scroll on phones. Names
	// wider than the plot itself get capped by `tagMax` + ellipsis in the markup.
	const TAG_EDGE = 8;
	function clampCenter(cx: number, w: number): number {
		const half = Math.min(w, Math.max(0, width - 2 * TAG_EDGE)) / 2;
		return Math.min(Math.max(cx, half + TAG_EDGE), width - half - TAG_EDGE);
	}
	let tagMax = $derived(Math.max(96, width - 2 * TAG_EDGE));

	let ghostLabel = $derived(mode === 'today' ? 'overall' : 'today');

	// All persistent labels share one layout pass so they never sit on top of one
	// another: the chosen city (the hero) and the "most similar sky" twin anchor to
	// their own clouds, the mode captions float on their curves, and lower-priority
	// labels get nudged upward until they clear anything already placed.
	interface LabelItem {
		key: string;
		kind: 'sel' | 'twin' | 'end';
		prio: number;
		x: number;
		top: number;
		w: number;
		h: number;
		name?: string;
		label?: string;
		solid?: boolean;
		// Cloud this label points at (narrow layout draws a stem to it).
		anchorX?: number;
		anchorY?: number;
	}

	let labels = $derived.by(() => {
		const lv = layout.live;
		const gv = layout.ghost;
		if (!width || lv.length < 2) return [] as LabelItem[];
		const innerW = Math.max(1, width - MARGIN_X * 2);

		const H_HERO = narrow ? 26 : 30;
		const H_TWIN = narrow ? 30 : 34;
		const H_END = 18;
		const cw = (s: string, per: number) => s.length * per;
		// The twin box is as wide as its "MOST SIMILAR SKY" caption, not the city
		// name — size the box off whichever is wider so the collision math is honest.
		const TWIN_CAP_W = 132;
		// Narrow: hero + twin ride this fixed row in the top padding, clear of the
		// distribution band, and connect down to their clouds with a drawn stem.
		const TOP_ROW = 2;

		const raw: LabelItem[] = [];

		// Chosen city — the hero. On wide screens it rests just above its own cloud;
		// on narrow it rides the top row and points down with a stem.
		if (selectedBox) {
			const w = cw(selectedBox.name, 12) + 24;
			const cloudTop = selectedBox.y - selectedBox.h / 2;
			raw.push({
				key: 'sel', kind: 'sel', prio: 0, name: selectedBox.name,
				x: clampCenter(selectedBox.x, w), w, h: H_HERO,
				top: narrow ? TOP_ROW : cloudTop - cell - 8 - H_HERO,
				anchorX: selectedBox.x, anchorY: cloudTop
			});
		}

		// Twin — the secondary "most similar sky". Pinned above its own cloud on wide
		// screens, or to the top row (with a stem) on narrow.
		if (arc && twin && twinName) {
			const tb = arc.twinBox;
			const w = Math.max(TWIN_CAP_W, cw(twinName, 9)) + 16;
			const cloudTop = tb.y - tb.h / 2;
			raw.push({
				key: 'twin', kind: 'twin', prio: 1, name: twinName,
				x: clampCenter(tb.x, w), w, h: H_TWIN,
				top: narrow ? TOP_ROW : cloudTop - cell - 8 - H_TWIN,
				anchorX: tb.x, anchorY: cloudTop
			});
		}

		// Mode captions (today / overall) floating on their curves.
		const at = (arr: number[], t: number) => ({ x: MARGIN_X + t * innerW, y: yFor(curveAt(arr, t)) });
		const live = at(lv, 0.42);
		raw.push({ key: 'end-live', kind: 'end', prio: 2, label: mode, solid: true,
			x: clampCenter(live.x, cw(mode, 9) + 4), w: cw(mode, 9) + 4, h: H_END, top: Math.max(4, live.y - 36) });
		if (gv.length > 1) {
			const gh = at(gv, 0.6);
			raw.push({ key: 'end-ghost', kind: 'end', prio: 3, label: ghostLabel, solid: false,
				x: clampCenter(gh.x, cw(ghostLabel, 9) + 4), w: cw(ghostLabel, 9) + 4, h: H_END, top: Math.max(4, gh.y - 36) });
		}

		const placed: LabelItem[] = [];
		const clash = (a: LabelItem, top: number) =>
			placed.find(
				(p) =>
					Math.abs(p.x - a.x) < (p.w + a.w) / 2 + 6 &&
					top < p.top + p.h + 4 &&
					top + a.h + 4 > p.top
			);

		// Narrow: hero + twin share the top row, so resolve their overlap sideways
		// (pushing them apart) rather than stacking them down into the band.
		if (narrow) {
			const row = raw
				.filter((r) => r.kind === 'sel' || r.kind === 'twin')
				.sort((a, b) => a.x - b.x);
			const lo = clampPad;
			const hi = width - clampPad;
			if (row.length === 2) {
				const [a, b] = row;
				const minSep = (a.w + b.w) / 2 + 10;
				let ax = a.x;
				let bx = b.x;
				// Only pry them apart when they'd actually collide.
				if (bx - ax < minSep) {
					const mid = (ax + bx) / 2;
					ax = mid - minSep / 2;
					bx = mid + minSep / 2;
				}
				// Slide the pair as a rigid unit to keep both inside the bounds
				// without reintroducing overlap.
				if (ax < lo) {
					bx += lo - ax;
					ax = lo;
				}
				if (bx > hi) {
					ax -= bx - hi;
					bx = hi;
				}
				a.x = Math.max(lo, ax);
				b.x = bx;
			}
			for (const it of row) {
				it.x = clampCenter(it.x, it.w);
				placed.push(it);
			}
		}

		for (const it of raw.slice().sort((a, b) => a.prio - b.prio)) {
			if (placed.includes(it)) continue;
			let top = it.top;
			for (let i = 0; i < 8; i++) {
				const c = clash(it, top);
				if (!c) break;
				top = c.top - it.h - 6;
			}
			placed.push({ ...it, top: Math.max(2, top) });
		}
		return placed;
	});

	let heroLabel = $derived(labels.find((l) => l.kind === 'sel') ?? null);
	let twinLabel = $derived(labels.find((l) => l.kind === 'twin') ?? null);
	let endLabels = $derived(labels.filter((l) => l.kind === 'end'));

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

	<svg
		bind:this={arcSvg}
		class="pointer-events-none invisible absolute inset-0 h-full w-full overflow-visible"
		aria-hidden="true"
	></svg>

	{#each endLabels as l (l.key)}
		<span
			class="text-shadow-sky pointer-events-none absolute z-10 -translate-x-1/2 text-sm tracking-[0.14em] whitespace-nowrap text-white uppercase {l.solid
				? 'font-bold'
				: 'font-normal opacity-60'}"
			style="left: {l.x}px; top: {l.top}px;"
		>
			{l.label}
		</span>
	{/each}

	{#if hovered && hovered.code !== selected}
		<div
			class="tag pointer-events-none absolute z-10 -translate-x-1/2 truncate text-white"
			style="left: {clampCenter(hovered.x, (hovered.name.length + 6) * 8 + 16)}px; top: {Math.max(
				2,
				hovered.y - hovered.h / 2 - 26
			)}px; max-width: {tagMax}px;"
		>
			{hovered.name} · {Math.round(hovered.mean)}%
		</div>
	{/if}

	{#if heroLabel}
		<div
			class="tag city-tag pointer-events-none absolute z-10 -translate-x-1/2 truncate text-sun-gold"
			style="left: {heroLabel.x}px; top: {heroLabel.top}px; max-width: {tagMax}px;"
		>
			{heroLabel.name}
		</div>
	{/if}

	{#if twinLabel && twin && !moving}
		<button
			class="tag twin-tag absolute z-10 -translate-x-1/2 cursor-pointer text-center whitespace-nowrap text-white transition-colors duration-120 hover:text-sun-gold"
			style="left: {twinLabel.x}px; top: {twinLabel.top}px; max-width: {tagMax}px;"
			onclick={() => onselect?.(twin.code)}
		>
			<span class="block text-[10px] leading-none tracking-[0.16em] uppercase opacity-60">
				Most similar sky
			</span>
			<span class="mt-1 block max-w-full truncate text-xs leading-tight tracking-wide">
				<span class="border-b-2 border-white/50">{twinLabel.name}</span>
			</span>
		</button>
	{/if}

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

	/* The chosen city is the hero of the chart: bigger, chunkier box, brighter
		shadow than the secondary "most similar sky" twin label. */
	.city-tag {
		padding: 6px 11px;
		font-size: 16px;
		letter-spacing: 0.1em;
		box-shadow: 3px 3px 0 color-mix(in srgb, var(--color-navy) 45%, transparent);
	}
</style>
