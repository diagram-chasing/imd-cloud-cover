<script lang="ts">
	import { sky } from '$lib/state/sky.svelte';

	interface Props {
		dates: string[]; // ascending window dates
	}
	let { dates }: Props = $props();

	// Clamp the selected index whenever the window changes.
	$effect(() => {
		if (sky.windowDayIndex > dates.length - 1) sky.windowDayIndex = dates.length - 1;
		if (sky.windowDayIndex < 0) sky.windowDayIndex = 0;
	});

	const WEEKDAY = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
	function label(iso: string): string {
		const d = new Date(iso + 'T00:00:00');
		return `${WEEKDAY[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, '0')}`;
	}

	let current = $derived(dates[sky.windowDayIndex] ?? dates[dates.length - 1]);

	// Same direct-manipulation timeline as the today scrubber: click or drag
	// anywhere on the track; ticks mark the window's days.
	let track = $state<HTMLDivElement>();
	let dragging = false;

	function stepFromX(clientX: number): number {
		if (!track) return sky.windowDayIndex;
		const r = track.getBoundingClientRect();
		const f = (clientX - r.left) / r.width;
		return Math.max(0, Math.min(dates.length - 1, Math.round(f * (dates.length - 1))));
	}
	function scrubTo(clientX: number) {
		sky.windowDayIndex = stepFromX(clientX);
	}
	function onpointerdown(e: PointerEvent) {
		dragging = true;
		scrubTo(e.clientX);
		try {
			(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		} catch {
			// capture is best-effort (keeps the drag through fast pointer moves)
		}
	}
	function onpointermove(e: PointerEvent) {
		if (dragging) scrubTo(e.clientX);
	}
	function onpointerup() {
		dragging = false;
	}
	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
			sky.windowDayIndex = Math.max(0, sky.windowDayIndex - 1);
			e.preventDefault();
		} else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
			sky.windowDayIndex = Math.min(dates.length - 1, sky.windowDayIndex + 1);
			e.preventDefault();
		}
	}

	let handleX = $derived(
		dates.length > 1 ? (sky.windowDayIndex / (dates.length - 1)) * 100 : 0
	);
</script>

<!-- Phone: the scrubber stretches to the full dock width. -->
<div class="win flex items-center max-md:w-full">
	<div
		class="timeline relative h-[34px] w-[min(300px,62vw)] cursor-pointer touch-none focus-visible:outline-offset-4 max-md:w-auto max-md:min-w-0 max-md:flex-auto"
		bind:this={track}
		role="slider"
		tabindex="0"
		aria-label="Day in window"
		aria-valuemin={0}
		aria-valuemax={dates.length - 1}
		aria-valuenow={sky.windowDayIndex}
		aria-valuetext={current ? label(current) : ''}
		{onpointerdown}
		{onpointermove}
		{onpointerup}
		{onkeydown}
	>
		<div class="rail absolute top-2 right-0 left-0 h-0.5 bg-white shadow-[1px_1px_0] shadow-navy/90"></div>
		{#each dates as d, i (d)}
			<span
				class="tick absolute top-1.5 -ml-px h-1.5 w-0.5 bg-white opacity-70 shadow-[1px_1px_0] shadow-navy/90"
				style="left:{dates.length > 1 ? (i / (dates.length - 1)) * 100 : 0}%"
			></span>
		{/each}
		<span
			class="handle absolute top-1 -ml-[5px] h-2.5 w-2.5 bg-sun-gold shadow-[0_0_0_2px_var(--color-ink),2px_2px_0_2px_color-mix(in_srgb,var(--color-navy)_50%,transparent)]"
			style="left:{handleX}%"
		></span>
		<!-- Date label follows the handle so the answer sits where you're looking. -->
		<span
			class="date absolute top-[18px] -translate-x-1/2 text-xs tracking-wider whitespace-nowrap text-white text-shadow-sky"
			style="left:{handleX}%">{current ? label(current) : ''}</span
		>
	</div>
</div>
