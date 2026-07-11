<script lang="ts">
	// Instant, map-shaped placeholder shown while the PIXI engine chunk loads and
	// paints its first frame. It fills the map frame with the same sky gradient the
	// canvas opens on, so there's no dead navy void and no layout shift — just a
	// quiet shimmer that reads as "the sky is loading", not "something is broken".
	interface Props {
		night?: boolean;
	}
	let { night = false }: Props = $props();

	// Matches theme.ts SKY palettes (day / night).
	let top = $derived(night ? '#081831' : '#2E7CC4');
	let bottom = $derived(night ? '#16335C' : '#6FC4EF');
</script>

<div
	class="map-shell absolute inset-0 overflow-hidden"
	style="--top:{top}; --bottom:{bottom}"
	aria-hidden="true"
>
	<div class="shimmer motion-reduce:hidden"></div>
</div>

<style>
	.map-shell {
		background: linear-gradient(to bottom, var(--top), var(--bottom));
	}
	/* A slow diagonal sheen sweeping across the sky — subtle, GPU-only transform. */
	.shimmer {
		position: absolute;
		inset: -50% -20%;
		background: linear-gradient(
			105deg,
			transparent 42%,
			rgba(255, 255, 255, 0.06) 50%,
			transparent 58%
		);
		transform: translateX(-40%);
		animation: shell-sweep 2.4s ease-in-out infinite;
	}
	@keyframes shell-sweep {
		0% {
			transform: translateX(-40%);
		}
		100% {
			transform: translateX(40%);
		}
	}
</style>
