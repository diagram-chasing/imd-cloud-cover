<script lang="ts">
	import { sky } from '$lib/state/sky.svelte';
	import { buildAtlas } from '$lib/map/sprites';
	import type { BandKey } from '$lib/theme';

	const CHIPS: { band: BandKey; label: string }[] = [
		{ band: 'high', label: 'HIGH·CIRRUS' },
		{ band: 'middle', label: 'MID·ALTO' },
		{ band: 'low', label: 'LOW·CUMULUS' }
	];

	// Draw each band's t2 sprite into a small preview canvas.
	function preview(node: HTMLCanvasElement, band: BandKey) {
		const atlas = buildAtlas(4);
		const sprite = atlas.get(band, 2);
		const ctx = node.getContext('2d')!;
		ctx.imageSmoothingEnabled = false;
		ctx.clearRect(0, 0, node.width, node.height);
		const w = sprite.wCells * 4;
		const h = sprite.hCells * 4;
		ctx.drawImage(sprite.canvas, (node.width - w) / 2, (node.height - h) / 2, w, h);
		return {};
	}
</script>

<div class="bands" role="group" aria-label="Cloud species">
	{#each CHIPS as chip (chip.band)}
		<button
			class="chip"
			class:off={!sky.bands[chip.band]}
			aria-pressed={sky.bands[chip.band]}
			onclick={() => sky.toggleBand(chip.band)}
		>
			<canvas width="40" height="16" use:preview={chip.band} aria-hidden="true"></canvas>
			<span>{chip.label}</span>
		</button>
	{/each}
</div>

<style>
	.bands {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.chip {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 8px;
		background: var(--paper);
		color: var(--ink);
		box-shadow: 0 0 0 2px var(--ink);
		font-family: var(--font-display);
		font-size: 10px;
		letter-spacing: 0.05em;
		cursor: pointer;
	}
	.chip.off {
		opacity: 0.35;
	}
	.chip:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
	canvas {
		image-rendering: pixelated;
	}
</style>
