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

<!-- One consolidated "when am I looking at" control: the time range sits above
     the matching scrubber for that range, centred as the map's primary axis. -->
<div class="dock">
	<ViewTabs />
	<div class="scrub">
		{#if sky.view === 'today'}
			<TimeScrubber />
		{:else if dates}
			<WindowScrubber {dates} />
		{/if}
	</div>
</div>

<style>
	.dock {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
	}
	.scrub {
		display: flex;
		justify-content: center;
	}
</style>
