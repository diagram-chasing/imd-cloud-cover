<script lang="ts">
	import { sky } from '$lib/state/sky.svelte';
	import { NIGHT_STEPS } from '$lib/theme';
	import PlayToggle from '$lib/components/PlayToggle.svelte';

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

	$effect(() => {
		if (!sky.playing || reduced) return;
		const id = setInterval(() => {
			sky.timeIndex = (sky.timeIndex + 1) % STEPS;
		}, 900);
		return () => clearInterval(id);
	});


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

	let handleX = $derived((sky.timeIndex / (STEPS - 1)) * 100);
	let night = $derived(NIGHT_STEPS.has(sky.timeIndex));
</script>

<div class="scrubber flex items-center gap-2.5 max-md:w-full">
	<div
		class="timeline relative h-[34px] w-[min(300px,62vw)] cursor-pointer touch-none focus-visible:outline-offset-4 max-md:w-auto max-md:min-w-0 max-md:flex-auto"
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
		<div
			class="rail absolute top-2 right-0 left-0 h-0.5 bg-white shadow-[1px_1px_0] shadow-navy/90"
		></div>
		{#each LABELS as label, i (label)}
			<span
				class="tick absolute top-[5px] -ml-px h-2 w-0.5 bg-white opacity-80 shadow-[1px_1px_0] shadow-navy/90"
				style="left:{(i / (STEPS - 1)) * 100}%"
			></span>
			<span
				class={[
					'tlabel absolute top-[18px] -translate-x-1/2 text-xs tracking-[0.04em] text-white text-shadow-sky',
					i === sky.timeIndex ? 'opacity-100' : 'opacity-60'
				]}
				style="left:{(i / (STEPS - 1)) * 100}%">{label}</span
			>
		{/each}
		<span
			class={[
				'handle absolute top-1 -ml-[5px] h-2.5 w-2.5 shadow-[0_0_0_2px_var(--color-ink),2px_2px_0_2px_color-mix(in_srgb,var(--color-navy)_50%,transparent)]',
				night ? 'bg-mist-200' : 'bg-sun-gold'
			]}
			style="left:{handleX}%"
		></span>
	</div>
	<PlayToggle
		playing={sky.playing}
		disabled={reduced}
		label="Play through the day"
		ontoggle={() => (sky.playing = !sky.playing)}
	/>
</div>
