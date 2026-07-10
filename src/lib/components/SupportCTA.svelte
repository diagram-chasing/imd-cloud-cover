<script lang="ts">
	import PixelButton from '$lib/components/PixelButton.svelte';
</script>

<figure
	class="support mx-auto flex max-w-[460px] flex-col items-center gap-3.5 bg-paper px-7 py-8 text-center"
>
	<p class="kicker m-0 text-sm tracking-[0.06em] uppercase">
		A <a href="https://diagramchasing.fun" class="text-ink underline underline-offset-[3px]"
			>Diagram Chasing</a
		> Production
	</p>

	<p class="blurb m-0 text-sm leading-relaxed text-pretty text-muted-foreground">
		This project is independently produced and reader-supported. Consider sending a tip so we can
		keep making work like this.
	</p>

	<PixelButton
		class="mt-1 text-sm font-bold tracking-[0.08em] uppercase"
		href="https://diagramchasing.fun/support"
		target="_blank"
		rel="noopener noreferrer"
	>
		₹ Support us
	</PixelButton>
</figure>
