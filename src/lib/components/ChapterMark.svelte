<script lang="ts">
	// Chapter divider for the below-the-fold article: `~ 01 · THE SOURCE ~`,
	// echoing the footer's "~ More From Us ~" tilde framing.
	let { num, title }: { num: string; title: string } = $props();
</script>

<h2
	class="chapter mt-18 mb-6 flex items-baseline justify-center gap-2.5 text-lg font-bold tracking-[0.09em] uppercase text-ink"
>
	<span class="tilde opacity-40" aria-hidden="true">~</span>
	<span class="num text-muted-foreground">{num}</span>
	<span class="sep opacity-40" aria-hidden="true">·</span>
	<span class="name">{title}</span>
	<span class="tilde opacity-40" aria-hidden="true">~</span>
</h2>
