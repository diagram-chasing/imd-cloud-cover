<script lang="ts">
	import type { Summary } from '$lib/types';
	import { buildHeadline } from '$lib/copy/headline';

	interface Props {
		summary: Summary;
		today: string;
	}
	let { summary, today }: Props = $props();
	let h = $derived(buildHeadline(summary, today));
</script>

<div class="headline-stat">
	<h1>{h.headline}</h1>
	<p class="sub">{h.subline}</p>
</div>

<style>
	.headline-stat {
		max-width: 22ch;
	}
	h1 {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: clamp(24px, 4.5vw, 40px);
		line-height: 1.15;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: var(--ink);
		margin: 0;
	}
	.sub {
		margin-top: 12px;
		font-family: var(--font-body);
		font-size: 13px;
		color: var(--ink);
		opacity: 0.75;
		max-width: 60ch;
	}
</style>
