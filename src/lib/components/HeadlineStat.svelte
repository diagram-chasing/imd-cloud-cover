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

<div class="headline-stat max-w-[22ch]">
	<h1 class="m-0 text-2xl leading-tight font-bold tracking-[0.02em] text-ink uppercase md:text-4xl">
		{h.headline}
	</h1>
	<p class="sub mt-3 max-w-[60ch] text-sm leading-relaxed text-ink opacity-75">{h.subline}</p>
</div>
