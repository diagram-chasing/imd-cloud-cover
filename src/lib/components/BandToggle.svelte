<script lang="ts">
	import { sky } from '$lib/state/sky.svelte';
	import { buildMarkAtlas } from '$lib/map/sprites';
	import type { BandKey } from '$lib/theme';
	import { ToggleGroup, ToggleGroupItem } from '$lib/components/ui/toggle-group';

	const CHIPS: { band: BandKey; label: string }[] = [
		{ band: 'high', label: 'HIGH·CIRRUS' },
		{ band: 'middle', label: 'MID·ALTO' },
		{ band: 'low', label: 'LOW·CUMULUS' }
	];

	// Draw each band's actual tower-mark glyph into its swatch, so the legend
	// matches what the map renders. Top tier (4) at full size reads boldest; the
	// dark "sky" chip behind it gives the pale ice/blue clouds real contrast.
	function preview(node: HTMLCanvasElement, band: BandKey) {
		const atlas = buildMarkAtlas(4);
		const sprite = atlas.get(band, 4, 0);
		const ctx = node.getContext('2d')!;
		ctx.imageSmoothingEnabled = false;
		ctx.clearRect(0, 0, node.width, node.height);
		const w = sprite.wCells * 4;
		const h = sprite.hCells * 4;
		ctx.drawImage(sprite.canvas, Math.round((node.width - w) / 2), Math.round((node.height - h) / 2));
		return {};
	}

	const itemClass =
		'gap-2 rounded-none border-0 border-r-2 border-[var(--ink)] bg-[var(--paper)] px-2.5 text-sm tracking-wider text-[var(--ink)] [font-family:var(--font-display)] h-10 last:border-r-0 ' +
		'hover:bg-[var(--cloud-block)] hover:text-[var(--ink)] data-[state=on]:bg-[var(--ink)] data-[state=on]:text-[var(--paper)] flex items-center justify-center';
</script>

<ToggleGroup
	type="single"
	value={sky.focusBand ?? 'all'}
	onValueChange={(v) => (sky.focusBand = v && v !== 'all' ? (v as BandKey) : null)}
	class="flex justify-center rounded-none border-2 border-[var(--ink)]"
	aria-label="Isolate cloud layer"
>
	<ToggleGroupItem value="all" class={itemClass}>ALL</ToggleGroupItem>
	{#each CHIPS as chip (chip.band)}
		<ToggleGroupItem value={chip.band} class={itemClass}>
			<canvas class="swatch" width="44" height="18" use:preview={chip.band} aria-hidden="true"></canvas>
			<span>{chip.label}</span>
		</ToggleGroupItem>
	{/each}
</ToggleGroup>

<style>
	/* A dark "sky" swatch so pale ice (high) and blue-grey (mid) clouds read with
	   contrast — matching how they look over the night map. */
	.swatch {
		image-rendering: pixelated;
		background: #0b1d3a;
		box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.15);
	}
</style>
