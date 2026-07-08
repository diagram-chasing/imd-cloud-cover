<script lang="ts">
	import { sky } from '$lib/state/sky.svelte';
	import { NIGHT_STEPS } from '$lib/theme';

	const LABELS = ['00', '03', '06', '09', '12', '15', '18', '21'];
	const STEPS = LABELS.length;

	let reduced = $state(false);
	$effect(() => {
		const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
		reduced = mq.matches;
		const on = () => (reduced = mq.matches);
		mq.addEventListener('change', on);
		return () => mq.removeEventListener('change', on);
	});

	// Autoplay loop.
	$effect(() => {
		if (!sky.playing || reduced) return;
		const id = setInterval(() => {
			sky.timeIndex = (sky.timeIndex + 1) % STEPS;
		}, 900);
		return () => clearInterval(id);
	});

	// One timeline: click or drag anywhere on the track to scrub. The handle is
	// a pixel sun (day steps) / moon square (night steps) riding the rail.
	let track = $state<HTMLDivElement>();
	let dragging = false;

	function stepFromX(clientX: number): number {
		if (!track) return sky.timeIndex;
		const r = track.getBoundingClientRect();
		const f = (clientX - r.left) / r.width;
		return Math.max(0, Math.min(STEPS - 1, Math.round(f * (STEPS - 1))));
	}
	function scrubTo(clientX: number) {
		sky.timeIndex = stepFromX(clientX);
		sky.playing = false;
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
			sky.timeIndex = Math.max(0, sky.timeIndex - 1);
			sky.playing = false;
			e.preventDefault();
		} else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
			sky.timeIndex = Math.min(STEPS - 1, sky.timeIndex + 1);
			sky.playing = false;
			e.preventDefault();
		}
	}

	// Handle centre as a % of track width.
	let handleX = $derived((sky.timeIndex / (STEPS - 1)) * 100);
	let night = $derived(NIGHT_STEPS.has(sky.timeIndex));
</script>

<div class="scrubber">
	<div
		class="timeline"
		bind:this={track}
		role="slider"
		tabindex="0"
		aria-label="Time of day (IST)"
		aria-valuemin={0}
		aria-valuemax={STEPS - 1}
		aria-valuenow={sky.timeIndex}
		aria-valuetext="{LABELS[sky.timeIndex]}:00 IST"
		{onpointerdown}
		{onpointermove}
		{onpointerup}
		{onkeydown}
	>
		<div class="rail"></div>
		{#each LABELS as label, i (label)}
			<span class="tick" style="left:{(i / (STEPS - 1)) * 100}%"></span>
			<span class="tlabel" class:on={i === sky.timeIndex} style="left:{(i / (STEPS - 1)) * 100}%"
				>{label}</span
			>
		{/each}
		<span class="handle" class:moon={night} style="left:{handleX}%"></span>
	</div>
	<button
		class="play"
		aria-label={sky.playing ? 'Pause' : 'Play through the day'}
		aria-pressed={sky.playing}
		disabled={reduced}
		onclick={() => (sky.playing = !sky.playing)}
	>
		{sky.playing ? '❚❚' : '▶'}
	</button>
</div>

<style>
	.scrubber {
		display: flex;
		align-items: center;
		gap: 10px;
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
		top: 5px;
		width: 2px;
		height: 8px;
		margin-left: -1px;
		background: #fff;
		box-shadow: 1px 1px 0 rgba(11, 29, 58, 0.9);
		opacity: 0.8;
	}
	.tlabel {
		position: absolute;
		top: 18px;
		transform: translateX(-50%);
		font-size: 10px;
		letter-spacing: 0.04em;
		color: #fff;
		opacity: 0.6;
		text-shadow: 1px 1px 0 rgba(11, 29, 58, 0.9);
	}
	.tlabel.on {
		opacity: 1;
	}
	/* Pixel sun riding the rail; flips to an ice moon on night steps. */
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
	.handle.moon {
		background: #cfe0f2;
	}
	.play {
		align-self: flex-start;
		margin-top: 1px;
		padding: 0 2px;
		color: #fff;
		font-size: 12px;
		line-height: 16px;
		letter-spacing: -0.1em;
		cursor: pointer;
		text-shadow: 1px 1px 0 rgba(11, 29, 58, 0.9);
		opacity: 0.85;
	}
	.play:hover {
		opacity: 1;
	}
	.play:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}
	.play:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
	/* Phone: the scrubber stretches to the full dock width. */
	@media (max-width: 767px) {
		.scrubber {
			width: 100%;
		}
		.timeline {
			width: auto;
			min-width: 0;
			flex: 1 1 auto;
		}
	}
</style>
