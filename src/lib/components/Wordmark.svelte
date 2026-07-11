<script lang="ts">
	// The publication brand mark — the pixel balloon + "DIAGRAM CHASING" wordmark
	// from the map's title block (PixelMap), reused as a DOM colophon on inner
	// pages. Links out to the studio.
	import PixelBalloon from './PixelBalloon.svelte';

	let { size = 22 }: { size?: number } = $props();
</script>

<a
	class="wordmark group inline-flex items-center gap-2.5 text-ink no-underline"
	href="https://diagramchasing.fun"
	target="_blank"
	rel="noopener"
>
	<PixelBalloon {size} />
	<span class="font-rough text-sm tracking-widest uppercase group-hover:text-focus">
		Diagram Chasing
	</span>
</a>
