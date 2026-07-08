<script lang="ts">
	import groundDayUrl from '$lib/assets/ground/ground-day.png';
	import groundNightUrl from '$lib/assets/ground/ground-night.png';

	interface Props {
		/** Current camera view rect in world coords (from PixelMap.onlayout). */
		view: { x: number; y: number; w: number; h: number };
		/** World dimensions the ground raster maps onto. */
		world: { w: number; h: number };
		night?: boolean;
	}
	let { view, world, night = false }: Props = $props();

	// A hair of open sea framing the land raster (top and bottom) so the world sits
	// inset in the thumbnail rather than bleeding off the edges, and the viewport box
	// has somewhere to go when the map pans past the northern/southern coasts. Given
	// as fractions of the world height; total vertical span the minimap covers.
	const V_TOP = 0.05;
	const V_BOT = 0.05;
	const V_SPAN = 1 + V_TOP + V_BOT;

	let box = $derived({
		left: (view.x / world.w) * 100,
		top: ((view.y + V_TOP * world.h) / (world.h * V_SPAN)) * 100,
		width: (view.w / world.w) * 100,
		height: (view.h / (world.h * V_SPAN)) * 100
	});
</script>

<div
	class="minimap"
	class:night
	style="aspect-ratio:{world.w} / {world.h * V_SPAN}; --land-top:{((V_TOP / V_SPAN) * 100).toFixed(
		3
	)}%; --land-h:{((1 / V_SPAN) * 100).toFixed(3)}%"
	aria-hidden="true"
>
	<img class="land" src={night ? groundNightUrl : groundDayUrl} alt="" />
	<div
		class="viewport"
		style="left:{box.left}%; top:{box.top}%; width:{box.width}%; height:{box.height}%"
	></div>
</div>

<style>
	.minimap {
		position: relative;
		width: 120px;
		overflow: hidden;
		background: #2e7cc4; /* day sea */
		box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.7);
	}
	.minimap.night {
		background: #0b1d3a; /* night sea */
		box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.6);
	}
	.land {
		position: absolute;
		top: var(--land-top);
		left: 0;
		width: 100%;
		height: var(--land-h);
		object-fit: fill;
		image-rendering: pixelated;
		opacity: 0.9;
	}
	.viewport {
		position: absolute;
		border: 1px solid #fff;
		box-sizing: border-box;
		box-shadow: 0 0 0 1px rgba(11, 29, 58, 0.6);
		pointer-events: none;
	}
</style>
