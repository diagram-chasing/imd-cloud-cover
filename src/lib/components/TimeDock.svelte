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

<!-- One consolidated "when am I looking at" control on a single rail-height row:
     the range tabs beside the matching scrubber. On phones the tabs hide — the
     page shows a collapsed view chip beside the layers row instead. -->
<div class="dock">
	<div class="tabs"><ViewTabs /></div>
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
		align-items: center;
		gap: 8px;
	}
	.scrub {
		display: flex;
		justify-content: center;
	}
	@media (max-width: 767px) {
		.tabs {
			display: none;
		}
	}
</style>
