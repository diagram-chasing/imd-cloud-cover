<script lang="ts">
	// Chapter divider for the below-the-fold article: `~ 01 · THE SOURCE ~`,
	// echoing the footer's "~ More From Us ~" tilde framing.
	let { num, title }: { num: string; title: string } = $props();
</script>

<h2 class="chapter">
	<span class="tilde" aria-hidden="true">~</span>
	<span class="num">{num}</span>
	<span class="sep" aria-hidden="true">·</span>
	<span class="name">{title}</span>
	<span class="tilde" aria-hidden="true">~</span>
</h2>

<style>
	.chapter {
		display: flex;
		align-items: baseline;
		justify-content: center;
		gap: 10px;
		margin: 72px 0 24px;
		font-family: var(--font-display);
		font-size: 17px;
		font-weight: 700;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--ink);
	}
	.tilde {
		opacity: 0.4;
	}
	.num {
		color: var(--muted-foreground);
	}
	.sep {
		opacity: 0.4;
	}
</style>
