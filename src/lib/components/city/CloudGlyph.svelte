<script lang="ts" module>
	// A pixel sun (sun-gold disc + rays) for clear-sky stations, 9×9 cells.
	const SUN: [number, number][] = [
		[4, 0],
		[1, 1], [7, 1],
		[3, 2], [4, 2], [5, 2],
		[2, 3], [3, 3], [4, 3], [5, 3], [6, 3],
		[0, 4], [2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [8, 4],
		[2, 5], [3, 5], [4, 5], [5, 5], [6, 5],
		[3, 6], [4, 6], [5, 6],
		[1, 7], [7, 7],
		[4, 8]
	];
	const SUN_W = 9;
</script>

<script lang="ts">
	// A station's sky as a small centred glyph — the map's cloud tower at list
	// scale, or a pixel sun when the sky is clear.
	import { buildTower } from '$lib/stations/clouds';

	let {
		code,
		values,
		cell = 3
	}: {
		code: string;
		values?: { h: number; m: number; l: number } | null;
		/** px per sprite cell */
		cell?: number;
	} = $props();

	let tower = $derived(buildTower(code, values));
</script>

{#if tower.cells.length}
	<svg
		class="block [shape-rendering:crispEdges]"
		style="width: {tower.w * cell}px; height: {tower.h * cell}px;"
		viewBox="0 0 {tower.w} {tower.h}"
		aria-hidden="true"
	>
		{#each tower.cells as c (c.x + '-' + c.y)}
			<rect x={c.x} y={c.y} width="1" height="1" fill={c.fill} opacity={c.opacity} />
		{/each}
	</svg>
{:else}
	<svg
		class="block text-sun-gold [shape-rendering:crispEdges]"
		style="width: {SUN_W * cell}px; height: {SUN_W * cell}px;"
		viewBox="0 0 {SUN_W} {SUN_W}"
		aria-hidden="true"
	>
		{#each SUN as [x, y] (x + '-' + y)}
			<rect {x} {y} width="1" height="1" fill="currentColor" />
		{/each}
	</svg>
{/if}
