<script lang="ts">
	import type { StationsManifest, AllStations, Rollup } from '$lib/types';
	import {
		lensMode,
		LENS_TITLE,
		monsoonFront,
		lowMeansFromLatest,
		lowMeansFromRollup,
		fogBelt,
		fogSparkline,
		afternoonBuildup
	} from '$lib/copy/lens';
	import { UI } from '$lib/theme';

	interface Props {
		manifest: StationsManifest;
		latest: AllStations;
		rollup7: Rollup;
		date: string;
		onwatch?: () => void;
	}
	let { manifest, latest, rollup7, date, onwatch }: Props = $props();

	let month = $derived(Number(date.slice(5, 7)));
	let mode = $derived(lensMode(month));

	// --- Monsoon / retreat ---
	let front = $derived(monsoonFront(manifest, lowMeansFromLatest(latest)));
	let frontThen = $derived(monsoonFront(manifest, lowMeansFromRollup(rollup7, 0)));
	// Only meaningful when the week-ago baseline actually has data.
	let frontDelta = $derived(
		frontThen.points.length ? Math.round((front.medianLat - frontThen.medianLat) * 10) / 10 : null
	);

	// --- Fog ---
	let fog = $derived(fogBelt(manifest, latest));
	let spark = $derived(fogSparkline(manifest, rollup7));

	// --- Afternoon ---
	let afternoon = $derived(afternoonBuildup(latest));

	// Lat/lon extent for the front sketch.
	const LON0 = 68,
		LON1 = 98,
		LAT0 = 6,
		LAT1 = 37;

	function frontSketch(node: HTMLCanvasElement) {
		$effect(() => {
			const W = node.width,
				H = node.height;
			const ctx = node.getContext('2d')!;
			ctx.clearRect(0, 0, W, H);
			ctx.fillStyle = '#eef4fb';
			ctx.fillRect(0, 0, W, H);
			const X = (lon: number) => ((lon - LON0) / (LON1 - LON0)) * W;
			const Y = (lat: number) => ((LAT1 - lat) / (LAT1 - LAT0)) * H;

			// median latitude reference line
			ctx.strokeStyle = 'rgba(11,29,58,0.25)';
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(0, Y(front.medianLat));
			ctx.lineTo(W, Y(front.medianLat));
			ctx.stroke();

			// front points as a dashed polyline
			ctx.strokeStyle = UI.accent;
			ctx.lineWidth = 2;
			ctx.setLineDash([4, 3]);
			ctx.beginPath();
			front.points.forEach((p, i) => {
				const x = X(p.lon),
					y = Y(p.lat);
				if (i === 0) ctx.moveTo(x, y);
				else ctx.lineTo(x, y);
			});
			ctx.stroke();
			ctx.setLineDash([]);

			// low-cloud markers
			ctx.fillStyle = '#ffffff';
			for (const p of front.points) ctx.fillRect(X(p.lon) - 1, Y(p.lat) - 1, 3, 3);
		});
	}

	function sparkline(node: HTMLCanvasElement) {
		$effect(() => {
			const W = node.width,
				H = node.height;
			const ctx = node.getContext('2d')!;
			ctx.clearRect(0, 0, W, H);
			const n = spark.length || 1;
			const bw = W / n;
			ctx.fillStyle = UI.accent;
			spark.forEach((v, i) => {
				const h = (v / 100) * H;
				ctx.fillRect(Math.floor(i * bw), H - h, Math.ceil(bw) - 1, h);
			});
		});
	}
</script>

<section class="lens">
	<h2>{LENS_TITLE[mode]}</h2>

	{#if mode === 'monsoon' || mode === 'retreat'}
		<div class="lens-grid">
			<div class="stat-block">
				<p class="big">
					THE CLOUD BANK {mode === 'retreat' ? 'RETREATS TO' : 'REACHES'}
					<span class="num">{front.medianLat.toFixed(1)}°N</span> TODAY.
				</p>
				{#if frontDelta !== null && frontDelta !== 0}
					<p class="delta">
						{frontDelta > 0 ? '▲' : '▼'}
						{Math.abs(frontDelta).toFixed(1)}° vs a week ago
					</p>
				{/if}
			</div>
			<canvas class="sketch" width="420" height="200" use:frontSketch aria-hidden="true"></canvas>
		</div>
	{:else if mode === 'fog'}
		<div class="lens-grid">
			<div class="stat-block">
				<p class="big">
					<span class="num">{fog.pct}%</span> OF THE PLAIN WAKES UNDER FOG.
				</p>
				<p class="delta">{fog.count} of {fog.total} Indo-Gangetic stations, 06:00 IST</p>
			</div>
			<canvas class="sketch" width="420" height="120" use:sparkline aria-hidden="true"></canvas>
		</div>
	{:else}
		<div class="lens-grid">
			<div class="stat-block">
				<p class="big">
					CLOUDS GREW <span class="num">{afternoon.delta > 0 ? '+' : ''}{afternoon.delta}</span> POINTS
					BY MID-AFTERNOON.
				</p>
				<p class="delta">{afternoon.at09} at 09:00 → {afternoon.at15} at 15:00</p>
				<button class="watch" onclick={() => onwatch?.()}>WATCH IT ▶</button>
			</div>
		</div>
	{/if}
</section>

<style>
	.lens {
		margin: 48px 0;
		border-top: 2px solid var(--ink);
		padding-top: 24px;
	}
	h2 {
		font-family: var(--font-display);
		font-size: 20px;
		letter-spacing: 0.05em;
	}
	.lens-grid {
		display: grid;
		grid-template-columns: 1fr minmax(0, 420px);
		gap: 24px;
		align-items: center;
	}
	.big {
		font-family: var(--font-display);
		font-size: clamp(18px, 3vw, 26px);
		line-height: 1.3;
		text-transform: uppercase;
	}
	.num {
		color: var(--accent);
	}
	.delta {
		font-family: var(--font-body);
		font-size: 13px;
		opacity: 0.75;
	}
	.sketch {
		width: 100%;
		max-width: 420px;
		box-shadow: 0 0 0 2px var(--ink);
		image-rendering: pixelated;
		background: #eef4fb;
	}
	.watch {
		margin-top: 12px;
		font-family: var(--font-display);
		font-size: 12px;
		padding: 6px 12px;
		background: var(--ink);
		color: var(--ink-on-dark);
		cursor: pointer;
	}
	.watch:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
	@media (max-width: 640px) {
		.lens-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
