<script lang="ts">
	import { sky } from '$lib/state/sky.svelte';
	import { buildMarkAtlas } from '$lib/map/sprites';
	import type { BandKey } from '$lib/theme';

	interface Props {
		/** Lay the options in a row (phone dock) instead of a column. */
		horizontal?: boolean;
	}
	let { horizontal = false }: Props = $props();

	const BANDS: { band: BandKey; label: string; short: string }[] = [
		{ band: 'high', label: 'HIGH · CIRRUS', short: 'HIGH' },
		{ band: 'middle', label: 'MID · ALTO', short: 'MID' },
		{ band: 'low', label: 'LOW · CUMULUS', short: 'LOW' }
	];

	// Draw each band's actual tower-mark glyph, so the legend matches what the
	// map renders. The glyphs sit directly on the sky — same as on the map.
	function preview(node: HTMLCanvasElement, band: BandKey) {
		const atlas = buildMarkAtlas(4);
		const sprite = atlas.get(band, 4, 0);
		const ctx = node.getContext('2d')!;
		ctx.imageSmoothingEnabled = false;
		ctx.clearRect(0, 0, node.width, node.height);
		const w = sprite.wCells * 4;
		const h = sprite.hCells * 4;
		ctx.drawImage(
			sprite.canvas,
			Math.round((node.width - w) / 2),
			Math.round((node.height - h) / 2)
		);
		return {};
	}

	// ALL shows the full stack as it appears on the map: a whole tower, the
	// three bands drawn small and stacked high-to-low.
	function previewAll(node: HTMLCanvasElement) {
		const atlas = buildMarkAtlas(2);
		const ctx = node.getContext('2d')!;
		ctx.imageSmoothingEnabled = false;
		ctx.clearRect(0, 0, node.width, node.height);
		const rows: { band: BandKey; y: number }[] = [
			{ band: 'high', y: 0 },
			{ band: 'middle', y: 6 },
			{ band: 'low', y: 12 }
		];
		for (const { band, y } of rows) {
			const sprite = atlas.get(band, 4, 0);
			const w = sprite.wCells * 2;
			ctx.drawImage(sprite.canvas, Math.round((node.width - w) / 2), y);
		}
		return {};
	}
</script>

<!-- The legend IS the control: a radio list of the map's own cloud glyphs.
     Pick a band to isolate that layer; ALL restores the full stack. The pixel
     radio squares + hover wash are what make it read as clickable. -->
<div class="legend" class:horizontal role="radiogroup" aria-label="Cloud layers">
	<button
		class="band all"
		role="radio"
		aria-checked={sky.focusBand === null}
		class:active={sky.focusBand === null}
		onclick={() => (sky.focusBand = null)}
	>
		<span class="box" aria-hidden="true"></span>
		<canvas class="swatch" width="44" height="18" use:previewAll aria-hidden="true"></canvas>
		<span class="label">ALL</span>
	</button>
	{#each BANDS as b (b.band)}
		<button
			class="band"
			role="radio"
			aria-checked={sky.focusBand === b.band}
			class:dim={sky.focusBand !== null && sky.focusBand !== b.band}
			class:active={sky.focusBand === b.band}
			onclick={() => (sky.focusBand = sky.focusBand === b.band ? null : b.band)}
		>
			<span class="box" aria-hidden="true"></span>
			<canvas class="swatch" width="44" height="18" use:preview={b.band} aria-hidden="true"
			></canvas>
			<span class="label">{horizontal ? b.short : b.label}</span>
		</button>
	{/each}
</div>

<style>
	.legend {
		display: flex;
		flex-direction: column;
		gap: 1px;
		font-family: var(--font-display);
	}
	.band {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 3px 6px 3px 4px;
		cursor: pointer;
		color: #fff;
		text-shadow: 1px 1px 0 rgba(11, 29, 58, 0.9);
		transition:
			opacity 0.12s,
			background-color 0.12s;
	}
	.band:hover {
		background: rgba(255, 255, 255, 0.12);
		opacity: 1;
	}
	.band.dim {
		opacity: 0.4;
	}
	/* Pixel radio square: hollow at rest, sun-gold when the option is live. */
	.box {
		flex: 0 0 auto;
		width: 8px;
		height: 8px;
		box-shadow:
			0 0 0 2px #fff,
			1px 1px 0 2px rgba(11, 29, 58, 0.9);
	}
	.band.active .box {
		background: var(--sun-gold);
	}
	.label {
		font-size: 12px;
		letter-spacing: 0.06em;
	}
	.swatch {
		image-rendering: pixelated;
		filter: drop-shadow(1px 1px 0 rgba(11, 29, 58, 0.6));
	}
	.band:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}

	.legend.horizontal {
		flex-direction: row;
		align-items: center;
		gap: 4px;
	}
	.legend.horizontal .band {
		gap: 5px;
		padding: 3px 5px;
	}
</style>
