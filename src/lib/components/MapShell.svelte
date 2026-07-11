<script lang="ts">
	// The map's loading state. It shows the exact baked ground raster the PIXI map
	// renders (same PNG), placed with the same start camera (map/camera.ts) — so it's
	// a solid, pixelated India in the precise spot the canvas will occupy. When the
	// live canvas fades in over it, only the clouds appear; the land doesn't move.
	import { startFrame, WORLD_W, WORLD_H } from '$lib/map/camera';
	import groundDayUrl from '$lib/assets/ground/ground-day.png';
	import groundNightUrl from '$lib/assets/ground/ground-night.png';

	interface Props {
		night?: boolean;
	}
	let { night = false }: Props = $props();

	let el = $state<HTMLDivElement>();
	let w = $state(0);
	let h = $state(0);

	// Measure synchronously on mount rather than via bind:clientWidth — the latter's
	// ResizeObserver fires async and gets starved by PIXI's synchronous init, so the
	// silhouette wouldn't draw before the canvas takes over. Measuring here renders
	// India in the shell's very first paint, during hydration.
	$effect(() => {
		if (!el) return;
		const measure = () => {
			w = el!.clientWidth;
			h = el!.clientHeight;
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	});

	// theme.ts SKY — the sky behind the ground (ground PNG has transparent sea).
	let top = $derived(night ? '#081831' : '#2E7CC4');
	let bottom = $derived(night ? '#16335C' : '#6FC4EF');
	let ground = $derived(night ? groundNightUrl : groundDayUrl);
	let frame = $derived(w && h ? startFrame(w, h) : null);
</script>

<div
	bind:this={el}
	class="map-shell absolute inset-0 overflow-hidden"
	style="--top:{top}; --bottom:{bottom}"
	aria-label="Loading the map"
>
	{#if frame}
		<svg class="absolute inset-0 h-full w-full" viewBox="0 0 {w} {h}" aria-hidden="true">
			<g
				transform="translate({-frame.panX * frame.zoom} {-frame.panY *
					frame.zoom}) scale({frame.zoom})"
			>
				<image
					class="ground"
					href={ground}
					x="0"
					y="0"
					width={WORLD_W}
					height={WORLD_H}
					preserveAspectRatio="none"
				/>
			</g>
		</svg>
	{/if}

	<!-- Pixel glyphs forming: three squares breathing in sequence, echoing the cloud
		marks about to appear. -->
	<div class="glyphs motion-reduce:hidden" aria-hidden="true">
		<span></span>
		<span></span>
		<span></span>
	</div>
</div>

<style>
	.map-shell {
		background: linear-gradient(to bottom, var(--top), var(--bottom));
	}
	.ground {
		image-rendering: pixelated;
	}
	.glyphs {
		position: absolute;
		inset-inline: 0;
		bottom: 16%;
		display: flex;
		justify-content: center;
		gap: 8px;
	}
	.glyphs span {
		width: 8px;
		height: 8px;
		background: rgba(255, 255, 255, 0.85);
		image-rendering: pixelated;
		animation: glyph-breathe 1.1s ease-in-out infinite;
	}
	.glyphs span:nth-child(2) {
		animation-delay: 0.18s;
	}
	.glyphs span:nth-child(3) {
		animation-delay: 0.36s;
	}
	@keyframes glyph-breathe {
		0%,
		100% {
			opacity: 0.25;
			transform: translateY(0) scale(0.85);
		}
		50% {
			opacity: 1;
			transform: translateY(-3px) scale(1);
		}
	}
</style>
