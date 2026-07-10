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

<!-- day-sea backdrop; night flips to navy (a fixed sea colour, not the flippable --ink) -->
<div
	class="minimap relative w-[120px] overflow-hidden bg-day-sea shadow-[0_0_0_1px] shadow-white/70 night:bg-navy night:shadow-white/60"
	style="aspect-ratio:{world.w} / {world.h * V_SPAN}; --land-top:{((V_TOP / V_SPAN) * 100).toFixed(
		3
	)}%; --land-h:{((1 / V_SPAN) * 100).toFixed(3)}%"
	aria-hidden="true"
>
	<img
		class="absolute top-[var(--land-top)] left-0 h-[var(--land-h)] w-full object-fill opacity-90 [image-rendering:pixelated]"
		src={night ? groundNightUrl : groundDayUrl}
		alt=""
	/>
	<!-- current camera rect; navy hairline stays put when --ink flips -->
	<div
		class="pointer-events-none absolute box-border border border-white shadow-[0_0_0_1px] shadow-navy/60"
		style="left:{box.left}%; top:{box.top}%; width:{box.width}%; height:{box.height}%"
	></div>
</div>
