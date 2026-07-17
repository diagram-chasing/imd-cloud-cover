<script lang="ts">

	import type { FeatureCollection } from 'geojson';
	import { goto } from '$app/navigation';
	import { base as APP_BASE } from '$app/paths';
	import { click as clickFx } from '$lib/feedback';
	import groundDayUrl from '$lib/assets/ground/ground-day.png';
	import { buildTower, type CloudTower } from '$lib/stations/clouds';
	import { indiaProjection } from '$lib/map/geo';
	import { WORLD_W, WORLD_H } from '$lib/map/camera';

	interface NearbyStation {
		code: string;
		name: string;
		lat: number;
		lon: number;
		km: number;
		primary?: boolean;
	}
	interface Props {
		india: FeatureCollection;
		/** The "you are here" gold diamond. Null when the primary is a station marker. */
		city: { name: string; lat: number; lon: number } | null;
		stations: NearbyStation[];
		/** Per-station cover at the current step, keyed by code — drives the clouds. */
		values?: Record<string, { h: number; m: number; l: number; p?: number }>;
		/** Adjoining cities: labelled only when they land inside the crop window. */
		places?: { name: string; lat: number; lon: number }[];
		/** Zoom floor as a fraction of the world width — larger = wider regional view. */
		minSpanFactor?: number;
		onhover?: (info: { code: string; clientX: number; clientY: number } | null) => void;
	}
	let {
		india,
		city,
		stations,
		values,
		places = [],
		minSpanFactor = 0.02,
		onhover
	}: Props = $props();

	const ASPECT = 1.2; // rendered width / height - landscape crops wider, not taller

	let projection = $derived(indiaProjection(india));

	let mapW = $state(320);
	let mapH = $derived(mapW / ASPECT);

	// label width estimate — declared before the point deriveds that use it so
	// SSR (which evaluates deriveds eagerly) doesn't hit its temporal dead zone.
	const CHAR_W = 7.4;
	const labelWidth = (t: string) => t.length * CHAR_W;

	// world px, no crop offset yet
	interface RawPoint {
		id: string;
		label: string;
		kind: 'city' | 'station' | 'place';
		accent: boolean;
		code: string | null;
		x: number;
		y: number;
		w: number;
	}
	let rawPoints = $derived.by<RawPoint[]>(() => {
		const out: RawPoint[] = [];
		const cp = city ? projection([city.lon, city.lat]) : null;
		if (city && cp) {
			out.push({
				id: '__city',
				label: city.name.toUpperCase(),
				kind: 'city',
				accent: true,
				code: null,
				x: cp[0],
				y: cp[1],
				w: labelWidth(city.name)
			});
		}
		for (const s of stations) {
			const p = projection([s.lon, s.lat]);
			if (!p) continue;
			out.push({
				id: s.code,
				label: s.name.toUpperCase(),
				kind: 'station',
				accent: !!s.primary,
				code: s.code,
				x: p[0],
				y: p[1],
				w: labelWidth(s.name)
			});
		}
		return out;
	});

	// adjoining cities; excluded from crop bbox, shown only if they fall inside it
	let placePoints = $derived.by<RawPoint[]>(() => {
		const out: RawPoint[] = [];
		for (const pl of places) {
			const p = projection([pl.lon, pl.lat]);
			if (!p) continue;
			out.push({
				id: `__place_${pl.name}`,
				label: pl.name.toUpperCase(),
				kind: 'place',
				accent: false,
				code: null,
				x: p[0],
				y: p[1],
				w: labelWidth(pl.name)
			});
		}
		return out;
	});

	// crop window: bbox + padding; floor prevents dense clusters (Delhi) collapsing to one pixel
	const PAD = 1.6;
	let MIN_S = $derived(WORLD_W * minSpanFactor);
	let win = $derived.by(() => {
		const pts = rawPoints;
		if (!pts.length) return null;
		let minX = Infinity;
		let maxX = -Infinity;
		let minY = Infinity;
		let maxY = -Infinity;
		for (const p of pts) {
			if (p.x < minX) minX = p.x;
			if (p.x > maxX) maxX = p.x;
			if (p.y < minY) minY = p.y;
			if (p.y > maxY) maxY = p.y;
		}
		const cx = (minX + maxX) / 2;
		const cy = (minY + maxY) / 2;
		let S = Math.max((maxX - minX) * PAD, (maxY - minY) * ASPECT * PAD, MIN_S);
		S = Math.min(S, WORLD_W);
		const Sy = S / ASPECT;
		const wx = Math.max(0, Math.min(WORLD_W - S, cx - S / 2));
		const wy = Math.max(0, Math.min(WORLD_H - Sy, cy - Sy / 2));
		return { wx, wy, S };
	});
	let k = $derived(win ? mapW / win.S : 1);

	const CLOUD_PX = 7; // px per sprite cell
	const DOT = 5; // locator dot diameter (px)
	const CLOUD_GAP = 5; // gap between the tower's base and the dot (px)

	let towers = $derived.by<Record<string, CloudTower>>(() => {
		const out: Record<string, CloudTower> = {};
		for (const s of stations) out[s.code] = buildTower(s.code, values?.[s.code]);
		return out;
	});

	// mark bbox for declutter; labels prefer below-first
	const MARK_W = 16;
	const MARK_H = 12;
	const MARK_HX = MARK_W / 2;
	const MARK_HY = MARK_H / 2;

	const LABEL_H = 12;
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
	const hitBox = (a: Box, b: Box) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

	interface Item {
		id: string;
		label: string;
		kind: 'city' | 'station' | 'place';
		accent: boolean;
		code: string | null;
		sx: number;
		sy: number;
		w: number;
	}

	let base = $derived.by<Item[]>(() => {
		const w = win;
		if (!w) return [];
		const out: Item[] = [];
		for (const p of [...rawPoints, ...placePoints]) {
			const sx = (p.x - w.wx) * k;
			const sy = (p.y - w.wy) * k;
			// "if in view": drop adjoining cities that fall outside the frame.
			if (p.kind === 'place' && (sx < 0 || sx > mapW || sy < 0 || sy > mapH)) continue;
			out.push({
				id: p.id,
				label: p.label,
				kind: p.kind,
				accent: p.accent,
				code: p.code,
				sx,
				sy,
				w: p.w
			});
		}
		return out;
	});

	const MIN_SEP = 66;
	let visible = $derived.by<Item[]>(() => {
		const kept: Item[] = [];
		for (const p of base) {
			if (p.kind === 'city' || p.accent) {
				kept.push(p);
				continue;
			}
			if (kept.every((q) => Math.hypot(q.sx - p.sx, q.sy - p.sy) >= MIN_SEP)) kept.push(p);
		}
		return kept;
	});

	let placed = $derived.by(() => {
		const items = visible;
		// city first, then accents, then top-to-bottom
		const order = [...items.keys()].sort((i, j) => {
			const a = items[i];
			const b = items[j];
			if (a.kind !== b.kind) return a.kind === 'city' ? -1 : 1;
			if (!!a.accent !== !!b.accent) return a.accent ? -1 : 1;
			return a.sy - b.sy;
		});
		const taken: Box[] = items.map((p) => ({
			l: p.sx - MARK_HX,
			r: p.sx + MARK_HX,
			t: p.sy - MARK_HY,
			b: p.sy + MARK_HY
		}));
		const boxFor = (p: Item, ox: number, oy: number, align: string): Box => {
			const l =
				align === 'center' ? p.sx + ox - p.w / 2 : align === 'right' ? p.sx + ox - p.w : p.sx + ox;
			return { l, r: l + p.w, t: p.sy + oy, b: p.sy + oy + LABEL_H };
		};
		const result = new Array(items.length);
		for (const i of order) {
			const p = items[i];
			let chosen: { ox: number; oy: number; align: string } | null = null;
			for (const c of CANDIDATES) {
				const b = boxFor(p, c.ox, c.oy, c.align);
				if (!taken.some((o) => hitBox(b, o))) {
					chosen = { ox: c.ox, oy: c.oy, align: c.align };
					taken.push(b);
					break;
				}
			}
			if (!chosen) {
				let oy = MARK_HY + 2;
				let b = boxFor(p, 0, oy, 'center');
				while (taken.some((o) => hitBox(b, o)) && oy < mapH) {
					oy += LABEL_H + 3;
					b = boxFor(p, 0, oy, 'center');
				}
				chosen = { ox: 0, oy, align: 'center' };
				taken.push(b);
			}
			result[i] = { ...p, lx: chosen.ox, ly: chosen.oy, align: chosen.align };
		}
		return result as (Item & { lx: number; ly: number; align: string })[];
	});

	const labelTransform = (align: string) =>
		align === 'center' ? 'translateX(-50%)' : align === 'right' ? 'translateX(-100%)' : 'none';

	// every marker is just a station now — go to its station page. Code-backed cities
	// 308-redirect from there to their canonical /stations/[slug] page.
	function open(code: string) {
		clickFx('open');
		onhover?.(null);
		goto(`${APP_BASE}/station/${code}`);
	}
</script>

<div
	bind:clientWidth={mapW}
	class="city-map relative w-full overflow-hidden bg-day-sea shadow-[0_0_0_1px] shadow-ink/40"
	style="aspect-ratio: {ASPECT};"
>
	{#if win}
		<!-- max-w-none/max-h-none: Tailwind preflight caps img to 100% width, breaking the zoomed raster -->
		<img
			class="absolute max-h-none max-w-none [image-rendering:pixelated] opacity-90"
			src={groundDayUrl}
			alt=""
			style="left: {-win.wx * k}px; top: {-win.wy * k}px; width: {WORLD_W * k}px; height: {WORLD_H *
				k}px;"
		/>
		{#each placed as p (p.id)}
			<!-- Only the station <button> should catch clicks; wide labels and the inert
			     city/place glyphs must not overlay and swallow taps meant for a neighbour. -->
			<div
				class="absolute [&>:not(button)]:pointer-events-none"
				style="left: {(p.sx / mapW) * 100}%; top: {(p.sy / mapH) * 100}%;"
			>
				{#if p.kind === 'city'}
					<svg
						class="absolute text-sun-gold [shape-rendering:crispEdges]"
						style="width: 13px; height: 13px; left: -6.5px; top: -6.5px; filter: drop-shadow(0 1px 0 rgba(11,29,58,0.85));"
						viewBox="0 0 7 7"
						aria-hidden="true"
					>
						<path d="M3 0h1v1h1v1h1v1h1v1h-1v1h-1v1h-1v1h-1v-1h-1v-1h-1v-1h-1v-1h1v-1h1v-1h1z" fill="currentColor" />
					</svg>
				{:else if p.kind === 'place'}
					<span
						class="absolute rounded-full border border-white/85 bg-day-sea/50 shadow-[0_0_0_1px] shadow-ink/50"
						style="width: 6px; height: 6px; left: -3px; top: -3px;"
						aria-hidden="true"
					></span>
				{:else}
					{@const tw = (p.code && towers[p.code]) || { cells: [], w: 0, h: 0 }}
					{@const cw = tw.w * CLOUD_PX}
					{@const ch = tw.h * CLOUD_PX}
					{@const hitW = Math.max(cw, MARK_W)}
								<button
						type="button"
						class="marker absolute block cursor-pointer bg-transparent p-0"
						style="width: {hitW}px; height: {ch + CLOUD_GAP + DOT}px; left: {-hitW /
							2}px; top: {-(ch + CLOUD_GAP)}px;"
						aria-label="{p.label} — open station"
						onpointermove={(e: PointerEvent) =>
							p.code && onhover?.({ code: p.code, clientX: e.clientX, clientY: e.clientY })}
						onpointerleave={() => onhover?.(null)}
						onclick={() => p.code && open(p.code)}
					>
						{#if tw.cells.length}
							<svg
								class="absolute [shape-rendering:crispEdges]"
								style="left: {(hitW - cw) / 2}px; top: 0; width: {cw}px; height: {ch}px; filter: drop-shadow(0 1px 0 rgba(11,29,58,0.3));"
								viewBox="0 0 {tw.w} {tw.h}"
								aria-hidden="true"
							>
								{#each tw.cells as c (c.x + '-' + c.y)}
									<rect x={c.x} y={c.y} width="1" height="1" fill={c.fill} opacity={c.opacity} />
								{/each}
							</svg>
						{/if}
						<span
							class={[
								'absolute rounded-full shadow-[0_0_0_1px] shadow-ink/80',
								p.accent ? 'bg-sun-gold' : 'bg-white'
							]}
							style="width: {DOT}px; height: {DOT}px; left: {hitW / 2 - DOT / 2}px; top: {ch +
								CLOUD_GAP -
								DOT / 2}px;"
						></span>
					</button>
				{/if}
				<span
					class={[
						'absolute text-[10px] leading-none font-bold tracking-[0.06em] whitespace-nowrap uppercase text-shadow-sky',
						p.kind === 'city'
							? 'text-sun-gold'
							: p.kind === 'place'
								? 'text-white/70'
								: 'text-white'
					]}
					style="left: {p.lx}px; top: {p.ly}px; transform: {labelTransform(p.align)};"
				>
					{p.label}
				</span>
			</div>
		{/each}
	{/if}
</div>
