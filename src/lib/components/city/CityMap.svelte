<script lang="ts">

	import type { FeatureCollection, Feature, Geometry } from 'geojson';
	import { geoConicConformal } from 'd3-geo';
	import { goto } from '$app/navigation';
	import { base as APP_BASE } from '$app/paths';
	import { click as clickFx } from '$lib/feedback';
	import groundDayUrl from '$lib/assets/ground/ground-day.png';
	import { buildTower, type CloudTower } from '$lib/city/clouds';

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
		city: { name: string; lat: number; lon: number };
		stations: NearbyStation[];
		/** Per-station cover at the current step, keyed by code — drives the clouds. */
		values?: Record<string, { h: number; m: number; l: number; p?: number }>;
		slugByCode: Record<string, string>;
		onhover?: (info: { code: string; clientX: number; clientY: number } | null) => void;
	}
	let { india, city, stations, values, slugByCode, onhover }: Props = $props();

	// The home map's world geometry (PixelMap WORLD_W / bake-ground.mjs), so the
	// ground raster and projected points agree on where India is.
	const WORLD_W = 1024;
	const WORLD_H = WORLD_W * 1.06;
	const CELL = 8;
	const ASPECT = 1.2; // rendered width / height — landscape: stations cluster wide, not tall

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

	let mapW = $state(320);
	let mapH = $derived(mapW / ASPECT);

	// City + station points in world px (no crop offset yet).
	interface RawPoint {
		id: string;
		label: string;
		kind: 'city' | 'station';
		accent: boolean;
		code: string | null;
		x: number;
		y: number;
		w: number;
	}
	let rawPoints = $derived.by<RawPoint[]>(() => {
		const out: RawPoint[] = [];
		const cp = projection([city.lon, city.lat]);
		if (cp) {
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

	// Crop window (world px): frame the pins' bounding box with padding, with a
	// generous minimum span so a tight cluster still shows regional context.
	const PAD = 1.6; // extra breathing room around the pin bbox
	// Zoom floor: enough regional context for a lone station, but small enough
	// that a dense metro cluster (Delhi) zooms in and spreads apart instead of
	// collapsing onto one pixel. Overlap that remains is handled by thinning below.
	const MIN_S = WORLD_W * 0.02;
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

	const CLOUD_PX = 7; // px per sprite cell — clouds are the content, so make them big
	const DOT = 5; // locator dot diameter (px)
	const CLOUD_GAP = 5; // gap between the tower's base and the dot (px)

	let towers = $derived.by<Record<string, CloudTower>>(() => {
		const out: Record<string, CloudTower> = {};
		for (const s of stations) out[s.code] = buildTower(s.code, values?.[s.code]);
		return out;
	});

	// Nominal mark box for the label declutter (labels hug the dot, below-first).
	const MARK_W = 16;
	const MARK_H = 12;
	const MARK_HX = MARK_W / 2;
	const MARK_HY = MARK_H / 2;

	const LABEL_H = 12;
	const CHAR_W = 7.4;
	const labelWidth = (t: string) => t.length * CHAR_W;
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
		kind: 'city' | 'station';
		accent: boolean;
		code: string | null;
		sx: number;
		sy: number;
		w: number;
	}

	let base = $derived.by<Item[]>(() => {
		const w = win;
		if (!w) return [];
		return rawPoints.map((p) => ({
			id: p.id,
			label: p.label,
			kind: p.kind,
			accent: p.accent,
			code: p.code,
			sx: (p.x - w.wx) * k,
			sy: (p.y - w.wy) * k,
			w: p.w
		}));
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
		// City locator first, then accents, then top-to-bottom.
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

	// Every station is a destination: its city if it backs one, else its station page.
	function open(code: string) {
		clickFx('open');
		onhover?.(null);
		const slug = slugByCode[code];
		goto(slug ? `${APP_BASE}/city/${slug}` : `${APP_BASE}/station/${code}`);
	}
</script>

<div
	bind:clientWidth={mapW}
	class="city-map relative w-full overflow-hidden bg-day-sea shadow-[0_0_0_1px] shadow-ink/40"
	style="aspect-ratio: {ASPECT};"
>
	{#if win}
		<!-- max-w-none/max-h-none: Tailwind preflight caps img at 100% width, which
			would shrink this oversized (zoomed) raster and push it off-screen. -->
		<img
			class="absolute max-h-none max-w-none [image-rendering:pixelated] opacity-90"
			src={groundDayUrl}
			alt=""
			style="left: {-win.wx * k}px; top: {-win.wy * k}px; width: {WORLD_W * k}px; height: {WORLD_H *
				k}px;"
		/>
		{#each placed as p (p.id)}
			<div
				class="absolute"
				style="left: {(p.sx / mapW) * 100}%; top: {(p.sy / mapH) * 100}%;"
			>
				{#if p.kind === 'city'}
					<!-- City locator: gold diamond, "you are here". -->
					<svg
						class="absolute text-sun-gold [shape-rendering:crispEdges]"
						style="width: 13px; height: 13px; left: -6.5px; top: -6.5px; filter: drop-shadow(0 1px 0 rgba(11,29,58,0.85));"
						viewBox="0 0 7 7"
						aria-hidden="true"
					>
						<path d="M3 0h1v1h1v1h1v1h1v1h-1v1h-1v1h-1v1h-1v-1h-1v-1h-1v-1h-1v-1h1v-1h1v-1h1z" fill="currentColor" />
					</svg>
				{:else}
					{@const tw = (p.code && towers[p.code]) || { cells: [], w: 0, h: 0 }}
					{@const cw = tw.w * CLOUD_PX}
					{@const ch = tw.h * CLOUD_PX}
					{@const hitW = Math.max(cw, MARK_W)}
					<!-- Hit area spans the drifting cloud tower down to the locator dot. -->
					<button
						type="button"
						class="marker absolute block cursor-pointer bg-transparent p-0"
						style="width: {hitW}px; height: {ch + CLOUD_GAP + DOT}px; left: {-hitW /
							2}px; top: {-(ch + CLOUD_GAP)}px;"
						aria-label={p.code && slugByCode[p.code]
							? `${p.label} — open city`
							: `${p.label} — open station`}
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
						<!-- Station locator: a crisp dot at the exact point (gold if primary). -->
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
						p.kind === 'city' ? 'text-sun-gold' : 'text-white'
					]}
					style="left: {p.lx}px; top: {p.ly}px; transform: {labelTransform(p.align)};"
				>
					{p.label}
				</span>
			</div>
		{/each}
	{/if}
</div>
