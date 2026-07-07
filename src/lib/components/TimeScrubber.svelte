<script lang="ts">
	import { sky } from '$lib/state/sky.svelte';
	import { NIGHT_STEPS } from '$lib/theme';
	import { Button } from '$lib/components/ui/button';
	import { ToggleGroup, ToggleGroupItem } from '$lib/components/ui/toggle-group';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { PlayIcon, PauseIcon } from '@hugeicons/core-free-icons';

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

	function select(v: string) {
		if (!v) return;
		sky.timeIndex = +v;
		sky.playing = false;
	}

	// Pixel-boxed play control — shares the visual language of the zoom buttons.
	const playClass =
		'size-8 rounded-none border-2 border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)] shadow-none hover:bg-[var(--ink)] hover:text-[var(--sun-gold)]';
	// Each 3-hour step. Vertical stack: day/night dot above, hour label below.
	const stepClass =
		'flex h-11 w-8 flex-col items-center justify-end gap-1 rounded-none border-0 border-r-2 border-[var(--ink)] bg-[var(--paper)] px-0 pb-1.5 text-[11px] tracking-wider text-[var(--ink)] [font-family:var(--font-display)] last:border-r-0 ' +
		'hover:bg-[var(--cloud-block)] hover:text-[var(--ink)] data-[state=on]:bg-[var(--ink)] data-[state=on]:text-[var(--paper)]';
</script>

<div class="scrubber" role="group" aria-label="Time of day">
	<Button
		variant="outline"
		size="icon"
		class={playClass}
		aria-label={sky.playing ? 'Pause' : 'Play through the day'}
		aria-pressed={sky.playing}
		disabled={reduced}
		onclick={() => (sky.playing = !sky.playing)}
	>
		<HugeiconsIcon icon={sky.playing ? PauseIcon : PlayIcon} strokeWidth={2.5} />
	</Button>

	<ToggleGroup
		type="single"
		value={String(sky.timeIndex)}
		onValueChange={select}
		class="rounded-none border-2 border-[var(--ink)]"
		aria-label="Time step (IST)"
	>
		{#each LABELS as label, i (label)}
			<ToggleGroupItem value={String(i)} class={stepClass} aria-label="{label}:00 IST">
				<span
					class="dot"
					class:moon={NIGHT_STEPS.has(i)}
					class:on={i === sky.timeIndex}
					aria-hidden="true"
				></span>
				<span>{label}</span>
			</ToggleGroupItem>
		{/each}
	</ToggleGroup>
</div>

<style>
	.scrubber {
		display: flex;
		align-items: stretch;
		gap: 8px;
		font-family: var(--font-display);
	}
	/* Day/night marker: sun-gold square for daytime steps, ice square for night.
	   Kept dim across the axis so the whole day reads at a glance; the focused
	   step brightens to full. */
	.dot {
		display: block;
		width: 8px;
		height: 8px;
		background: var(--sun-gold);
		opacity: 0.4;
	}
	.dot.moon {
		background: #cfe0f2;
		box-shadow: 2px -2px 0 0 var(--paper);
	}
	.dot.on {
		opacity: 1;
	}
</style>
