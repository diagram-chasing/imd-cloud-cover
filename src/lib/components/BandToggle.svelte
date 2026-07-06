<script lang="ts">
	import { sky } from '$lib/state/sky.svelte';
	import { buildAtlas } from '$lib/map/sprites';
	import type { BandKey } from '$lib/theme';
	import { ToggleGroup, ToggleGroupItem } from '$lib/components/ui/toggle-group';

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

	const itemClass =
		'gap-1.5 rounded-none border-0 border-r-2 border-[var(--ink)] bg-[var(--paper)] px-2 text-[10px] tracking-wider text-[var(--ink)] [font-family:var(--font-display)] last:border-r-0 ' +
		'hover:bg-[var(--cloud-block)] hover:text-[var(--ink)] data-[state=on]:bg-[var(--ink)] data-[state=on]:text-[var(--paper)]';
</script>

<ToggleGroup
	type="single"
	value={sky.focusBand ?? 'all'}
	onValueChange={(v) => (sky.focusBand = v && v !== 'all' ? (v as BandKey) : null)}
	class="rounded-none border-2 border-[var(--ink)]"
	aria-label="Isolate cloud layer"
>
	<ToggleGroupItem value="all" class={itemClass}>ALL</ToggleGroupItem>
	{#each CHIPS as chip (chip.band)}
		<ToggleGroupItem value={chip.band} class={itemClass}>
			<canvas width="40" height="16" use:preview={chip.band} aria-hidden="true"></canvas>
			<span>{chip.label}</span>
		</ToggleGroupItem>
	{/each}
</ToggleGroup>

<style>
	canvas {
		image-rendering: pixelated;
	}
</style>
