<script lang="ts">
	import { sky } from '$lib/state/sky.svelte';
	import ViewTabs from '$lib/components/ViewTabs.svelte';
	import TimeScrubber from '$lib/components/TimeScrubber.svelte';
	import WindowScrubber from '$lib/components/WindowScrubber.svelte';

	interface Props {
		dates?: string[] | null;
		/** Per-date data availability, aligned to `dates`; false = no reading that day. */
		available?: boolean[] | null;
	}
	let { dates = null, available = null }: Props = $props();
</script>

<div class="dock flex flex-col items-start gap-1.5">
	<ViewTabs />
	{#if sky.view === 'today'}
		<TimeScrubber />
	{:else if dates}
		<WindowScrubber {dates} {available} />
	{/if}
</div>
