<script lang="ts" module>
	import { CLOUD, SKY, type BandKey } from '$lib/theme';
	import { MARK_ALPHA, buildMarkAtlas, type SpriteAtlas } from '$lib/map/sprites';
	import { skyCondition } from '$lib/format';
	import { buildLayerOrder, groundProfile, lerpHex } from '$lib/skywindow';

	const BANDS: { key: 'h' | 'm' | 'l'; band: BandKey; label: string }[] = [
		{ key: 'h', band: 'high', label: 'HIGH · CIRRUS' },
		{ key: 'm', band: 'middle', label: 'MID · ALTO' },
		{ key: 'l', band: 'low', label: 'LOW · CUMULUS' }
	];

	const PRESETS = [
		{ name: 'PLEASANT WEATHER', h: 15, m: 10, l: 35 },
		{ name: 'CIRRUS CLOUDS', h: 75, m: 0, l: 0 },
		{ name: 'MOSTLY ALTO', h: 20, m: 80, l: 10 },
		{ name: 'MONSOON', h: 40, m: 70, l: 90 }
	];

	const NAVY = '#0b1d3a';
	const NEAR_KM = 250;

	let atlas3: SpriteAtlas | undefined;
	function swatch(node: HTMLCanvasElement, band: BandKey) {
		atlas3 ??= buildMarkAtlas(3);
		const sprite = atlas3.get(band, 4, 0);
		const ctx = node.getContext('2d')!;
		ctx.imageSmoothingEnabled = false;
		ctx.clearRect(0, 0, node.width, node.height);
		ctx.drawImage(
			sprite.canvas,
			Math.round((node.width - sprite.wCells * 3) / 2),
			Math.round((node.height - sprite.hCells * 3) / 2)
		);
	}
</script>

<script lang="ts">
	import type { BandValues, StationsManifest } from '$lib/types';
	import { userGeo } from '$lib/state/geo.svelte';
	import { haversineKm } from '$lib/stations/distance';
	import { click, tap } from '$lib/feedback';
	import PixelButton from '$lib/components/PixelButton.svelte';
	import StationSearch from '$lib/components/StationSearch.svelte';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { SearchIcon } from '@hugeicons/core-free-icons';

	interface Props {
		manifest?: StationsManifest;
		values?: BandValues;
	}
	let { manifest = undefined, values = undefined }: Props = $props();

	let cover = $state({ h: PRESETS[0].h, m: PRESETS[0].m, l: PRESETS[0].l });
	let station = $state<{ code: string; name: string } | null>(null);
	let label = $derived(skyCondition(cover));
	let activePreset = $derived(
		PRESETS.find((p) => p.h === cover.h && p.m === cover.m && p.l === cover.l)?.name ?? null
	);

	let root = $state<HTMLElement>();
	let canvas = $state<HTMLCanvasElement>();
	let width = $state(0);
	let height = $state(0);
	let reduced = $state(false);
	let onScreen = $state(false);
	let driftTick = $state(0);

	$effect(() => {
		const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
		reduced = mq.matches;
		const on = () => (reduced = mq.matches);
		mq.addEventListener('change', on);
		return () => mq.removeEventListener('change', on);
	});

	$effect(() => {
		if (!root) return;
		const io = new IntersectionObserver(([e]) => (onScreen = e.isIntersecting));
		io.observe(root);
		return () => io.disconnect();
	});

	$effect(() => {
		if (reduced || !onScreen) return;
		const id = setInterval(() => driftTick++, 2800);
		return () => clearInterval(id);
	});

	const GROUND_ROWS = 1;
	let grid = $derived.by(() => {
		if (!width || !height) return null;
		const B = width < 480 ? 8 : 12;

		const cols = Math.max(4, Math.ceil(width / B));
		const rows = Math.max(4, Math.floor(height / B) - GROUND_ROWS);
		return { B, cols, rows };
	});
	let layers = $derived.by(() => {
		if (!grid) return null;
		return {
			high: buildLayerOrder('high', grid.cols, grid.rows),
			middle: buildLayerOrder('middle', grid.cols, grid.rows),
			low: buildLayerOrder('low', grid.cols, grid.rows)
		};
	});
	let ground = $derived.by(() => (grid ? groundProfile(grid.cols) : null));

	let raf = 0;
	$effect(() => {
		void cover.h;
		void cover.m;
		void cover.l;
		void layers;
		void driftTick;
		if (!canvas || !grid || !layers) return;
		cancelAnimationFrame(raf);
		raf = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(raf);
	});

	function draw() {
		if (!canvas || !grid || !layers || !ground) return;
		const { B, cols, rows } = grid;
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		canvas.width = Math.round(width * dpr);
		canvas.height = Math.round(height * dpr);
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		ctx.scale(dpr, dpr);
		ctx.imageSmoothingEnabled = false;

		const bandH = height / 5;
		for (let i = 0; i < 5; i++) {
			ctx.fillStyle = lerpHex(SKY.day.top, SKY.day.bottom, i / 4);
			ctx.fillRect(0, i * bandH, width, bandH + 1);
		}

		const v = { high: cover.h, middle: cover.m, low: cover.l };
		const dx: Record<BandKey, number> = {
			high: reduced ? 0 : (driftTick >> 2) % cols,
			middle: reduced ? 0 : (driftTick >> 1) % cols,
			low: reduced ? 0 : driftTick % cols
		};
		for (const band of ['high', 'middle', 'low'] as const) {
			const o = layers[band];
			const n = Math.round((v[band] / 100) * o.total);
			if (!n) continue;
			ctx.globalAlpha = MARK_ALPHA[band];
			ctx.fillStyle = CLOUD[band].fill;
			for (let i = 0; i < n; i++) {
				ctx.fillRect(((o.x[i] + dx[band]) % cols) * B, o.y[i] * B, B, B);
			}
			if (band === 'low') {
				const drawn = new Uint8Array(cols * rows);
				for (let i = 0; i < n; i++) drawn[o.y[i] * cols + ((o.x[i] + dx.low) % cols)] = 1;
				ctx.fillStyle = CLOUD.low.shadow;
				for (let i = 0; i < n; i++) {
					const bx = (o.x[i] + dx.low) % cols;
					const by = o.y[i];

					const base = by + 1 >= rows || !drawn[(by + 1) * cols + bx];
					const deep = by >= 2 && drawn[(by - 1) * cols + bx] && drawn[(by - 2) * cols + bx];
					if (base || deep) ctx.fillRect(bx * B, by * B, B, B);
				}
			}
		}
		ctx.globalAlpha = 1;

		ctx.fillStyle = NAVY;
		const gy = rows * B;
		ctx.fillRect(0, gy, width, height - gy);
		for (let c = 0; c < cols; c++) {
			const rise = ground.rise[c];
			if (rise) ctx.fillRect(c * B, gy - rise * B, B, rise * B);
			if (ground.antenna[c]) ctx.fillRect(c * B + Math.floor(B / 2) - 1, gy - rise * B - B, 2, B);
		}
	}

	let touched = false;

	function setSliders(h: number, m: number, l: number) {
		cover = { h, m, l };
	}
	function applyPreset(p: (typeof PRESETS)[number]) {
		touched = true;
		station = null;
		click('open');
		tap('light');
		setSliders(p.h, p.m, p.l);
	}
	function onSlide(key: 'h' | 'm' | 'l', value: number) {
		touched = true;
		station = null;
		cover[key] = value;
	}

	let hasValues = $derived(!!values && Object.keys(values).length > 0);
	$effect(() => {
		userGeo.ensure();
	});
	let nearest = $derived.by(() => {
		const loc = userGeo.loc;
		if (!loc || !manifest || !values) return null;
		let best: string | null = null;
		let bestKm = Infinity;
		for (const [code, st] of Object.entries(manifest.stations)) {
			if (!values[code]) continue;
			const km = haversineKm(loc.lat, loc.lng, st.lat, st.lon);
			if (km < bestKm) {
				bestKm = km;
				best = code;
			}
		}
		return bestKm <= NEAR_KM ? best : null;
	});
	function setStation(code: string): boolean {
		const v = values?.[code];
		const st = manifest?.stations[code];
		if (!v || !st) return false;
		station = { code, name: st.name };
		setSliders(Math.round(v.h), Math.round(v.m), Math.round(v.l));
		return true;
	}
	function pickStation(code: string) {
		touched = true;
		if (setStation(code)) {
			click('open');
			tap('light');
		}
	}
	function pickMyLocation() {
		touched = true;
		if (nearest && setStation(nearest)) {
			click('open');
			tap('light');
		}
	}
	// silent default: your sky, not a hypothetical, is the opening state
	$effect(() => {
		if (touched || station || !nearest) return;
		setStation(nearest);
	});
</script>

<div class="skywin" bind:this={root}>
	<header class="head">View from the ground</header>
	<div class="window">
		<div class="frame" bind:clientWidth={width} bind:clientHeight={height}>
			<canvas bind:this={canvas} class="block h-full w-full [image-rendering:pixelated]"></canvas>
		</div>
		<div class="readout" aria-live="polite">
			<strong>{label}</strong>
		</div>
	</div>
	<div class="rail">
		<fieldset>
			<legend class="sr-only">Set cloud cover by layer</legend>
			{#each BANDS as b (b.key)}
				<label class="slider">
					<span class="s-head">
						<canvas
							class="drop-shadow-[1px_1px_0] drop-shadow-navy/60 [image-rendering:pixelated]"
							width="30"
							height="12"
							use:swatch={b.band}
							aria-hidden="true"
						></canvas>
						<span class="s-name">{b.label}</span>
						<span class="s-val">{cover[b.key]}%</span>
					</span>
					<input
						type="range"
						min="0"
						max="100"
						step="1"
						value={cover[b.key]}
						style="--band: {CLOUD[b.band].fill}; --fill: {cover[b.key]}%"
						aria-label="{b.label} cloud cover"
						aria-valuetext="{cover[b.key]}% of the sky"
						oninput={(e) => onSlide(b.key, +e.currentTarget.value)}
						onchange={() => click('select')}
					/>
				</label>
			{/each}
		</fieldset>
		<div class="chips">
			{#each PRESETS as p (p.name)}
				<PixelButton
					size="xs"
					cap="paper"
					aria-pressed={activePreset === p.name}
					onclick={() => applyPreset(p)}
				>
					{p.name}
				</PixelButton>
			{/each}
		</div>
		{#if manifest && hasValues}
			<div class="station">
				<StationSearch
					{manifest}
					onselect={pickStation}
					onmylocation={pickMyLocation}
					side="bottom"
					align="start"
				>
					{#snippet trigger(props)}
						<button type="button" {...props} class="st-field">
							<HugeiconsIcon icon={SearchIcon} strokeWidth={2} size={14} class="shrink-0" />
							<span class="st-name">{station?.name ?? 'Find a station'}</span>
						</button>
					{/snippet}
				</StationSearch>
			</div>
		{/if}
	</div>
	<p class="sr-only">
		Interactive sky window. High clouds cover {cover.h}%, middle {cover.m}%, low {cover.l}% of the
		sky — a ground observer would call this {label.toLowerCase()}.
	</p>
</div>

<style>
	.skywin {
		max-width: 54rem;
		margin-inline: auto;
		display: grid;
		grid-template-columns: minmax(0, 1fr) 220px;
		gap: calc(0.5 * var(--leading)) var(--leading);
		align-items: start;
	}
	@media (max-width: 48em) {
		.skywin {
			grid-template-columns: minmax(0, 1fr);
			gap: calc(0.5 * var(--leading));
		}
	}

	.head {
		grid-column: 1 / -1;
		justify-content: center;
		align-items: center;
		font-size: calc(var(--ms-1) * 1rem);
		font-weight: 700;
		text-transform: uppercase;
	}

	.window {
		border: 2px solid var(--ink);
		box-shadow: 6px 6px 0 var(--cloud-block);
		background: var(--navy);
	}
	.frame {
		height: clamp(240px, 30vw, 320px);
	}
	@media (max-width: 48em) {
		.frame {
			height: 220px;
		}
	}

	.readout {
		padding: 5px 9px 7px;
		background: var(--navy);
		color: var(--ink-on-dark);
		font-size: calc(var(--ms--1) * 1rem);
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.readout strong {
		color: var(--sun-gold);
		letter-spacing: 0.06em;
	}

	fieldset {
		border: 0;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: calc(0.3 * var(--leading));
	}

	.slider {
		display: block;
	}
	.s-head {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: calc(var(--ms--1) * 1rem);
		font-weight: 700;
		letter-spacing: 0.08em;
	}
	.s-name {
		flex: auto;
	}
	.s-val {
		font-weight: 400;
		font-variant-numeric: tabular-nums;
		opacity: 0.75;
	}

	input[type='range'] {
		appearance: none;
		-webkit-appearance: none;
		display: block;
		width: 100%;
		height: 26px; /* comfortable touch target; track is drawn thin */
		margin: 0;
		background: transparent;
		cursor: pointer;
	}
	input[type='range']::-webkit-slider-runnable-track {
		height: 6px;
		background: linear-gradient(
			to right,
			var(--band) 0 var(--fill),
			color-mix(in srgb, var(--ink) 18%, transparent) var(--fill)
		);
		box-shadow:
			0 0 0 1px var(--ink),
			2px 2px 0 color-mix(in srgb, var(--navy) 25%, transparent);
	}
	input[type='range']::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 14px;
		height: 14px;
		margin-top: -4px;
		border-radius: 0;
		background: var(--band);
		/* the TimeScrubber handle ring */
		box-shadow:
			0 0 0 2px var(--ink),
			2px 2px 0 2px color-mix(in srgb, var(--navy) 50%, transparent);
	}
	input[type='range']::-moz-range-track {
		height: 6px;
		background: linear-gradient(
			to right,
			var(--band) 0 var(--fill),
			color-mix(in srgb, var(--ink) 18%, transparent) var(--fill)
		);
		box-shadow:
			0 0 0 1px var(--ink),
			2px 2px 0 color-mix(in srgb, var(--navy) 25%, transparent);
	}
	input[type='range']::-moz-range-thumb {
		width: 14px;
		height: 14px;
		border: 0;
		border-radius: 0;
		background: var(--band);
		box-shadow:
			0 0 0 2px var(--ink),
			2px 2px 0 2px color-mix(in srgb, var(--navy) 50%, transparent);
	}

	.chips {
		margin-top: calc(0.5 * var(--leading));
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
	}

	.station {
		margin-top: calc(0.5 * var(--leading));
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.st-label {
		font-size: calc(var(--ms--1) * 1rem);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		opacity: 0.7;
	}
	.st-field {
		display: flex;
		align-items: center;
		gap: 7px;
		width: 100%;
		padding: 6px 8px;
		border: 2px solid var(--ink);
		background: var(--paper);
		box-shadow: 3px 3px 0 var(--cloud-block);
		font-size: calc(var(--ms--1) * 1rem);
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		cursor: pointer;
	}
	.st-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
