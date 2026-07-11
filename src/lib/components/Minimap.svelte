<script lang="ts">
	import groundDayUrl from '$lib/assets/ground/ground-day.png';
	import groundNightUrl from '$lib/assets/ground/ground-night.png';

	interface Props {
		view: { x: number; y: number; w: number; h: number };
		world: { w: number; h: number };
		night?: boolean;
	}
	let { view, world, night = false }: Props = $props();


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
	<div
		class="pointer-events-none absolute box-border border border-white shadow-[0_0_0_1px] shadow-navy/60"
		style="left:{box.left}%; top:{box.top}%; width:{box.width}%; height:{box.height}%"
	></div>
</div>
