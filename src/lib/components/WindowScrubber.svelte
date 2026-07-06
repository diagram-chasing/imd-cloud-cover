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
</script>

<div class="win" role="group" aria-label="Date">
	<div class="controls">
		<button
			class="nav"
			aria-label="Previous day"
			disabled={sky.windowDayIndex <= 0}
			onclick={() => (sky.windowDayIndex = Math.max(0, sky.windowDayIndex - 1))}>◀</button
		>
		<span class="date">{current ? label(current) : ''}</span>
		<button
			class="nav"
			aria-label="Next day"
			disabled={sky.windowDayIndex >= dates.length - 1}
			onclick={() => (sky.windowDayIndex = Math.min(dates.length - 1, sky.windowDayIndex + 1))}
			>▶</button
		>
	</div>
	<input
		type="range"
		min="0"
		max={dates.length - 1}
		value={sky.windowDayIndex}
		aria-label="Day in window"
		aria-valuetext={current ? label(current) : ''}
		oninput={(e) => (sky.windowDayIndex = +e.currentTarget.value)}
	/>

	<button
		class="persist"
		class:active={sky.persistence}
		aria-pressed={sky.persistence}
		onclick={() => (sky.persistence = !sky.persistence)}
	>
		PERSISTENCE
	</button>
</div>

<style>
	.win {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
		font-family: var(--font-display);
	}
	.controls {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.nav {
		width: 24px;
		height: 24px;
		box-shadow: 0 0 0 2px var(--ink);
		color: var(--ink);
		cursor: pointer;
		font-size: 10px;
	}
	.nav:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}
	.date {
		font-size: 12px;
		min-width: 64px;
		text-align: center;
		letter-spacing: 0.05em;
	}
	input[type='range'] {
		flex: 1;
		min-width: 160px;
		accent-color: var(--accent);
	}
	.persist {
		font-family: var(--font-display);
		font-size: 10px;
		letter-spacing: 0.05em;
		padding: 4px 8px;
		box-shadow: 0 0 0 2px var(--ink);
		color: var(--ink);
		background: var(--paper);
		cursor: pointer;
	}
	.persist.active {
		background: var(--ink);
		color: var(--ink-on-dark);
	}
	.persist:focus-visible,
	.nav:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
</style>
