<script lang="ts">
	import type { FeatureCollection } from 'geojson';
	import type { Feature, Geometry } from 'geojson';
	import { geoConicConformal } from 'd3-geo';
	import groundDayUrl from '$lib/assets/ground/ground-day.png';

	interface Pin {
		label: string;
		lat: number;
		lon: number;
		accent?: boolean;
	}
	interface Props {
		india: FeatureCollection;
		pins: Pin[];
	}
	let { india, pins }: Props = $props();

	const WORLD_W = 1024;
	const WORLD_H = WORLD_W * 1.06;
	const CELL = 8;

	const V_TOP = 0.05;
	const V_BOT = 0.05;
	const V_SPAN = 1 + V_TOP + V_BOT;
	const ASPECT = WORLD_W / (WORLD_H * V_SPAN);
	const CLOUD_W = 6;
	const CLOUD_H = 4;
	const CLOUD_CELLS: [number, number][] = [
		[2, 0], [3, 0],
		[1, 1], [2, 1], [3, 1], [4, 1],
		[0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [5, 2],
		[0, 3], [1, 3], [2, 3], [3, 3], [4, 3], [5, 3]
	];
	const MARK_W = 15;
	const MARK_H = MARK_W * (CLOUD_H / CLOUD_W);
	const MARK_HX = MARK_W / 2;
	const MARK_HY = MARK_H / 2;

	let projection = $derived(
		geoConicConformal()
			.parallels([12, 36])
			.rotate([-82.5, 0])
			.fitExtent(
				[
					[CELL, CELL],
					[WORLD_W - CELL, WORLD_H - CELL]
				],
				india as unknown as Feature<Geometry>
			)
	);


	let mapW = $state(180);

	const LABEL_H = 11;

	const CHAR_W = 7.2;
	const labelWidth = (text: string) => text.length * CHAR_W;


	const CANDIDATES = [
		{ ox: 0, oy: MARK_HY + 2, align: 'center' },
		{ ox: 0, oy: -MARK_HY - 2 - LABEL_H, align: 'center' },
		{ ox: MARK_HX + 2, oy: -LABEL_H / 2, align: 'left' },
		{ ox: -MARK_HX - 2, oy: -LABEL_H / 2, align: 'right' },
		{ ox: 0, oy: MARK_HY + 2 + LABEL_H + 3, align: 'center' },
		{ ox: 0, oy: -MARK_HY - 2 - 2 * LABEL_H - 3, align: 'center' }
	] as const;

	interface Box {
		l: number;
		r: number;
		t: number;
		b: number;
	}
	const hit = (a: Box, b: Box) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

	let placed = $derived.by(() => {
		const mapH = mapW / ASPECT;
		const base = pins
			.map((p) => {
				const pt = projection([p.lon, p.lat]);
				if (!pt) return null;
				return {
					...p,
					sx: (pt[0] / WORLD_W) * mapW,
					sy: ((pt[1] + V_TOP * WORLD_H) / (WORLD_H * V_SPAN)) * mapH,
					w: labelWidth(p.label)
				};
			})
			.filter((p) => p !== null);


		const order = [...base.keys()].sort((i, j) => {
			const a = base[i];
			const b = base[j];
			if (!!a.accent !== !!b.accent) return a.accent ? -1 : 1;
			return a.sy - b.sy;
		});

		const taken: Box[] = base.map((p) => ({
			l: p.sx - MARK_HX,
			r: p.sx + MARK_HX,
			t: p.sy - MARK_HY,
			b: p.sy + MARK_HY
		}));

		const boxFor = (p: (typeof base)[number], ox: number, oy: number, align: string): Box => {
			const l = align === 'center' ? p.sx + ox - p.w / 2 : align === 'right' ? p.sx + ox - p.w : p.sx + ox;
			return { l, r: l + p.w, t: p.sy + oy, b: p.sy + oy + LABEL_H };
		};

		const result = new Array(base.length);
		for (const i of order) {
			const p = base[i];
			let chosen: { ox: number; oy: number; align: string } | null = null;
			for (const c of CANDIDATES) {
				const b = boxFor(p, c.ox, c.oy, c.align);
				if (!taken.some((o) => hit(b, o))) {
					chosen = { ox: c.ox, oy: c.oy, align: c.align };
					taken.push(b);
					break;
				}
			}

			if (!chosen) {
				let oy = MARK_HY + 2;
				let b = boxFor(p, 0, oy, 'center');
				while (taken.some((o) => hit(b, o)) && oy < mapH) {
					oy += LABEL_H + 3;
					b = boxFor(p, 0, oy, 'center');
				}
				chosen = { ox: 0, oy, align: 'center' };
				taken.push(b);
			}
			result[i] = {
				...p,
				left: (p.sx / mapW) * 100,
				top: (p.sy / mapH) * 100,
				lx: chosen.ox,
				ly: chosen.oy,
				align: chosen.align
			};
		}
		return result;
	});

	const labelTransform = (align: string) =>
		align === 'center' ? 'translateX(-50%)' : align === 'right' ? 'translateX(-100%)' : 'none';
</script>

<div
	bind:clientWidth={mapW}
	class="twin-map relative w-full max-w-[240px] overflow-hidden bg-day-sea shadow-[0_0_0_1px] shadow-ink/40"
	style="aspect-ratio: {WORLD_W} / {WORLD_H * V_SPAN}; --land-top: {(
		(V_TOP / V_SPAN) *
		100
	).toFixed(3)}%; --land-h: {((1 / V_SPAN) * 100).toFixed(3)}%"
	aria-hidden="true"
>
	<img
		class="absolute top-[var(--land-top)] left-0 h-[var(--land-h)] w-full object-fill opacity-90 [image-rendering:pixelated]"
		src={groundDayUrl}
		alt=""
	/>
	{#each placed as p (p.label)}
		<div class="absolute" style="left: {p.left}%; top: {p.top}%;">

			<svg
				class={['absolute [shape-rendering:crispEdges]', p.accent ? 'text-sun-gold' : 'text-white']}
				style="width: {MARK_W}px; height: {MARK_H}px; left: {-MARK_HX}px; top: {-MARK_HY}px; filter: drop-shadow(0 1px 0 rgba(11, 29, 58, 0.75));"
				viewBox="0 0 {CLOUD_W} {CLOUD_H}"
			>
				{#each CLOUD_CELLS as [cx, cy]}
					<rect x={cx} y={cy} width="1" height="1" fill="currentColor" />
				{/each}
			</svg>
			<span
				class="absolute text-[10px] leading-none font-bold tracking-[0.06em] whitespace-nowrap text-white uppercase text-shadow-sky"
				style="left: {p.lx}px; top: {p.ly}px; transform: {labelTransform(p.align)};"
			>
				{p.label}
			</span>
		</div>
	{/each}
</div>
