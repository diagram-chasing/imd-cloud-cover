<script lang="ts">
	import { sky } from '$lib/state/sky.svelte';
	import PlayToggle from '$lib/components/PlayToggle.svelte';

	interface Props {
		dates: string[];
		/** Per-date data availability, aligned to `dates`; false = no reading that day. */
		available?: boolean[] | null;
	}
	let { dates, available = null }: Props = $props();

	// Days with no reading are dimmed and skipped by stepping/autoplay (drag can still land
	// on them). Unknown availability (no array) counts as present, so nothing is hidden.
	function hasData(i: number): boolean {
		return !available || available[i] !== false;
	}
	// Nearest data-bearing day from `from` going `dir` (±1), no wrap; stays put if none.
	function seek(from: number, dir: number): number {
		for (let i = from + dir; i >= 0 && i <= dates.length - 1; i += dir) {
			if (hasData(i)) return i;
		}
		return from;
	}
	// Next data-bearing day after `from`, wrapping; falls back to +1 if every day is empty.
	function nextData(from: number): number {
		for (let step = 1; step <= dates.length; step++) {
			const i = (from + step) % dates.length;
			if (hasData(i)) return i;
		}
		return (from + 1) % dates.length;
	}

	$effect(() => {
		if (sky.windowDayIndex > dates.length - 1) sky.windowDayIndex = dates.length - 1;
		if (sky.windowDayIndex < 0) sky.windowDayIndex = 0;
	});

	let reduced = $state(false);
	$effect(() => {
		const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
		reduced = mq.matches;
		const on = () => (reduced = mq.matches);
		mq.addEventListener('change', on);
		return () => mq.removeEventListener('change', on);
	});

	// autoplay steps one day per tick, looping at the end of the window
	$effect(() => {
		if (!sky.playing || reduced || dates.length < 2) return;
		const id = setInterval(() => {
			sky.windowDayIndex = nextData(sky.windowDayIndex);
		}, 900);
		return () => clearInterval(id);
	});

	const WEEKDAY = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
	function label(iso: string): string {
		const d = new Date(iso + 'T00:00:00');
		return `${WEEKDAY[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, '0')}`;
	}

	let current = $derived(dates[sky.windowDayIndex] ?? dates[dates.length - 1]);
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
		sky.playing = false;
	}
	function onpointerdown(e: PointerEvent) {
		dragging = true;
		scrubTo(e.clientX);
		try {
			(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		} catch {
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
			sky.windowDayIndex = seek(sky.windowDayIndex, -1);
			sky.playing = false;
			e.preventDefault();
		} else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
			sky.windowDayIndex = seek(sky.windowDayIndex, 1);
			sky.playing = false;
			e.preventDefault();
		}
	}

	let handleX = $derived(dates.length > 1 ? (sky.windowDayIndex / (dates.length - 1)) * 100 : 0);
</script>

<div class="win flex items-center gap-2.5 max-md:w-full">
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
		<div
			class="rail absolute top-2 right-0 left-0 h-0.5 bg-white shadow-[1px_1px_0] shadow-navy/90"
		></div>
		{#each dates as d, i (d)}
			<span
				class={[
					'tick absolute top-1.5 -ml-px h-1.5 w-0.5 bg-white shadow-[1px_1px_0] shadow-navy/90',
					hasData(i) ? 'opacity-70' : 'opacity-25'
				]}
				style="left:{dates.length > 1 ? (i / (dates.length - 1)) * 100 : 0}%"
			></span>
		{/each}
		<span
			class="handle absolute top-1 -ml-[5px] h-2.5 w-2.5 bg-sun-gold shadow-[0_0_0_2px_var(--color-ink),2px_2px_0_2px_color-mix(in_srgb,var(--color-navy)_50%,transparent)]"
			style="left:{handleX}%"
		></span>
		<span
			class="date absolute top-[18px] -translate-x-1/2 text-xs tracking-wider whitespace-nowrap text-white text-shadow-sky"
			style="left:{handleX}%">{current ? label(current) : ''}</span
		>
	</div>
	<PlayToggle
		playing={sky.playing}
		disabled={reduced}
		label="Play through the window"
		ontoggle={() => (sky.playing = !sky.playing)}
	/>
</div>
