<script lang="ts">
	import { sky } from '$lib/state/sky.svelte';
	import ViewTabs from '$lib/components/ViewTabs.svelte';
	import TimeScrubber from '$lib/components/TimeScrubber.svelte';
	import WindowScrubber from '$lib/components/WindowScrubber.svelte';

	interface Props {
		// Window dates for the week/month views; null while today is active.
		dates?: string[] | null;
	}
	let { dates = null }: Props = $props();
</script>

<!-- One consolidated "when am I looking at" control: the text range switcher
     rides above the matching scrubber like a chart annotation. -->
<div class="dock">
	<ViewTabs />
	{#if sky.view === 'today'}
		<TimeScrubber />
	{:else if dates}
		<WindowScrubber {dates} />
	{/if}
</div>

<style>
	.dock {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
	}
</style>
