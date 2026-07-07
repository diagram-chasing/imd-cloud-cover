<script lang="ts">
	import { sky } from '$lib/state/sky.svelte';
</script>

<!-- Display-mode toggle (a WHAT control): overlays the fog-belt persistence
     raster. A quiet text toggle with a pixel checkbox, matching the legend. -->
<button
	class="persist"
	class:active={sky.persistence}
	aria-pressed={sky.persistence}
	onclick={() => (sky.persistence = !sky.persistence)}
>
	<span class="box" aria-hidden="true"></span>
	PERSISTENCE
</button>

<style>
	.persist {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 2px 4px 2px 0;
		font-family: var(--font-display);
		font-size: 11px;
		letter-spacing: 0.06em;
		color: #fff;
		opacity: 0.65;
		cursor: pointer;
		text-shadow: 1px 1px 0 rgba(11, 29, 58, 0.9);
	}
	.persist:hover,
	.persist.active {
		opacity: 1;
	}
	.box {
		width: 9px;
		height: 9px;
		box-shadow:
			0 0 0 2px #fff,
			1px 1px 0 2px rgba(11, 29, 58, 0.9);
	}
	.persist.active .box {
		background: var(--sun-gold);
	}
	.persist:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
</style>
