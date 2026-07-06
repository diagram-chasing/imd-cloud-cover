<script lang="ts">
	import { sky } from '$lib/state/sky.svelte';
	import { SKY_RAMP, NIGHT_STEPS } from '$lib/theme';

	const LABELS = ['00', '03', '06', '09', '12', '15', '18', '21'];

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
			sky.timeIndex = (sky.timeIndex + 1) % 8;
		}, 900);
		return () => clearInterval(id);
	});

	function select(i: number) {
		sky.timeIndex = i;
		sky.playing = false;
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'ArrowLeft') {
			sky.timeIndex = (sky.timeIndex + 7) % 8;
			e.preventDefault();
		} else if (e.key === 'ArrowRight') {
			sky.timeIndex = (sky.timeIndex + 1) % 8;
			e.preventDefault();
		}
	}
</script>

<div class="scrubber" role="group" aria-label="Time of day">
	<button
		class="play"
		aria-label={sky.playing ? 'Pause' : 'Play through the day'}
		aria-pressed={sky.playing}
		onclick={() => (sky.playing = !sky.playing)}
		disabled={reduced}
	>
		{sky.playing ? '❚❚' : '▶'}
	</button>

	<div class="steps" tabindex="0" role="slider"
		aria-label="Time step"
		aria-valuemin={0} aria-valuemax={7} aria-valuenow={sky.timeIndex}
		aria-valuetext="{LABELS[sky.timeIndex]}:00 IST"
		onkeydown={onKey}>
		{#each LABELS as label, i (label)}
			<div class="cell">
				<span class="glyph" class:show={i === sky.timeIndex}>
					<span class="icon" class:moon={NIGHT_STEPS.has(i)}></span>
				</span>
				<button
					class="step"
					class:active={i === sky.timeIndex}
					aria-label="{label}:00 IST"
					aria-pressed={i === sky.timeIndex}
					onclick={() => select(i)}
				>
					{label}
				</button>
			</div>
		{/each}
	</div>
</div>

<style>
	.scrubber {
		display: flex;
		align-items: flex-end;
		gap: 8px;
		font-family: var(--font-display);
	}
	.play {
		width: 28px;
		height: 28px;
		background: var(--ink);
		color: var(--ink-on-dark);
		box-shadow: 0 0 0 2px var(--ink);
		font-size: 11px;
		cursor: pointer;
	}
	.play:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}
	.steps {
		display: flex;
		gap: 4px;
	}
	.steps:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 3px;
	}
	.cell {
		display: flex;
		flex-direction: column;
		align-items: center;
	}
	.glyph {
		height: 12px;
		visibility: hidden;
	}
	.glyph.show {
		visibility: visible;
	}
	.icon {
		display: block;
		width: 8px;
		height: 8px;
		background: var(--sun-gold);
	}
	.icon.moon {
		background: #cfe0f2;
		box-shadow: 2px -2px 0 0 var(--paper);
	}
	.step {
		width: 28px;
		height: 28px;
		font-family: var(--font-display);
		font-size: 11px;
		letter-spacing: 0.05em;
		background: transparent;
		color: var(--ink);
		box-shadow: 0 0 0 2px var(--ink);
		cursor: pointer;
	}
	.step.active {
		background: #fff;
		color: var(--accent);
	}
	.step:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
</style>
