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

<div class="win">
	<div
		class="timeline"
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
		<div class="rail"></div>
		{#each dates as d, i (d)}
			<span class="tick" style="left:{dates.length > 1 ? (i / (dates.length - 1)) * 100 : 0}%"
			></span>
		{/each}
		<span class="handle" style="left:{handleX}%"></span>
		<span class="date" style="left:{handleX}%">{current ? label(current) : ''}</span>
	</div>
</div>

<style>
	.win {
		display: flex;
		align-items: center;
		font-family: var(--font-display);
	}
	.timeline {
		position: relative;
		width: min(300px, 62vw);
		height: 34px;
		cursor: pointer;
		touch-action: none;
	}
	.timeline:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 4px;
	}
	.rail {
		position: absolute;
		top: 8px;
		left: 0;
		right: 0;
		height: 2px;
		background: #fff;
		box-shadow: 1px 1px 0 rgba(11, 29, 58, 0.9);
	}
	.tick {
		position: absolute;
		top: 6px;
		width: 2px;
		height: 6px;
		margin-left: -1px;
		background: #fff;
		box-shadow: 1px 1px 0 rgba(11, 29, 58, 0.9);
		opacity: 0.7;
	}
	.handle {
		position: absolute;
		top: 4px;
		width: 10px;
		height: 10px;
		margin-left: -5px;
		background: var(--sun-gold);
		box-shadow:
			0 0 0 2px var(--ink),
			2px 2px 0 2px rgba(11, 29, 58, 0.5);
	}
	/* Date label follows the handle so the answer sits where you're looking. */
	.date {
		position: absolute;
		top: 18px;
		transform: translateX(-50%);
		font-size: 10px;
		letter-spacing: 0.05em;
		white-space: nowrap;
		color: #fff;
		text-shadow: 1px 1px 0 rgba(11, 29, 58, 0.9);
	}
</style>
