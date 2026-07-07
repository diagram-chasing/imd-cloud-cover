<script lang="ts">
	import { sky } from '$lib/state/sky.svelte';
</script>

<!-- Display-mode toggle (a WHAT control): overlays the fog-belt persistence
     raster. Lives beside the band legend, not inside the time scrubber. -->
<button
	class="persist"
	class:active={sky.persistence}
	aria-pressed={sky.persistence}
	onclick={() => (sky.persistence = !sky.persistence)}
>
	PERSISTENCE
</button>

<style>
	.persist {
		font-family: var(--font-display);
		font-size: 10px;
		letter-spacing: 0.05em;
		height: 44px; /* one rail height, matching the toggle groups */
		padding: 0 10px;
		border: 2px solid var(--ink);
		color: var(--ink);
		background: var(--paper);
		cursor: pointer;
	}
	.persist.active {
		background: var(--ink);
		color: var(--ink-on-dark);
	}
	.persist:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
</style>
