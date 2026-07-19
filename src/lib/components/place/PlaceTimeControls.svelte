<script lang="ts">
	import PixelButton from '$lib/components/PixelButton.svelte';

	interface Props {
		/** ISO dates available to scrub, index 0 = the reading's base day. */
		days: string[];
		dayIndex: number;
		timeIndex: number;
		/** True when the selection matches the visitor's live clock (disables NOW). */
		isLive: boolean;
		/** The live clock position, for the "now" marker on the rail. */
		liveDay: number;
		liveTime: number;
		onchange: (dayIndex: number, timeIndex: number) => void;
		onnow: () => void;
	}
	let { days, dayIndex, timeIndex, isLive, liveDay, liveTime, onchange, onnow }: Props = $props();

	const HOUR_LABELS = ['00', '03', '06', '09', '12', '15', '18', '21'];
	const STEPS = HOUR_LABELS.length;
	const MONTHS = [
		'JAN',
		'FEB',
		'MAR',
		'APR',
		'MAY',
		'JUN',
		'JUL',
		'AUG',
		'SEP',
		'OCT',
		'NOV',
		'DEC'
	];

	// One continuous timeline: every 3-hour step across every day is one position.
	let total = $derived(Math.max(1, days.length * STEPS));
	let step = $derived(dayIndex * STEPS + timeIndex);
	let frac = $derived(total > 1 ? step / (total - 1) : 0);
	let nowStep = $derived(liveDay * STEPS + liveTime);
	let nowFrac = $derived(total > 1 ? nowStep / (total - 1) : 0);

	// Day gridlines: labelled with day-of-month, current day highlighted. The first
	// day of the strip and every month rollover also carry a month name, so the rail
	// reads unmistakably as a run of dates (not clock hours).
	let dayTicks = $derived(
		days.map((iso, i) => {
			const [, m, d] = iso.split('-').map(Number);
			const prevM = i > 0 ? Number(days[i - 1].split('-')[1]) : null;
			return {
				i,
				dom: String(d ?? '').padStart(2, '0'),
				mon: m && (i === 0 || m !== prevM) ? MONTHS[m - 1] : null,
				frac: total > 1 ? (i * STEPS) / (total - 1) : 0
			};
		})
	);

	function ariaText(): string {
		const iso = days[dayIndex] ?? days[0] ?? '';
		const [y, m, d] = iso.split('-').map(Number);
		const date = m && d ? `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}` : iso;
		return `${date}, ${HOUR_LABELS[timeIndex]}:00 IST`;
	}

	let track = $state<HTMLDivElement>();
	let dragging = false;

	function commit(s: number) {
		const clamped = Math.max(0, Math.min(total - 1, s));
		const d = Math.floor(clamped / STEPS);
		const t = clamped % STEPS;
		if (d !== dayIndex || t !== timeIndex) onchange(d, t);
	}
	function scrubTo(clientX: number) {
		if (!track) return;
		const r = track.getBoundingClientRect();
		const f = (clientX - r.left) / r.width;
		commit(Math.round(f * (total - 1)));
	}
	function onpointerdown(e: PointerEvent) {
		dragging = true;
		scrubTo(e.clientX);
		try {
			(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		} catch {
			/* capture unsupported — dragging still works via move events */
		}
	}
	function onpointermove(e: PointerEvent) {
		if (dragging) scrubTo(e.clientX);
	}
	function onpointerup() {
		dragging = false;
	}
	function onkeydown(e: KeyboardEvent) {
		const k = e.key;
		if (k === 'ArrowLeft' || k === 'ArrowDown') commit(step - 1);
		else if (k === 'ArrowRight' || k === 'ArrowUp') commit(step + 1);
		else if (k === 'PageDown') commit(step - STEPS);
		else if (k === 'PageUp') commit(step + STEPS);
		else if (k === 'Home') commit(0);
		else if (k === 'End') commit(total - 1);
		else return;
		e.preventDefault();
	}
</script>

<div class="time-scrubber flex items-center gap-3 text-ink">
	<div
		class="track relative h-[44px] flex-1 cursor-pointer touch-none select-none focus-visible:outline-offset-4"
		bind:this={track}
		role="slider"
		tabindex="0"
		aria-label="Day and hour (IST)"
		aria-valuemin={0}
		aria-valuemax={total - 1}
		aria-valuenow={step}
		aria-valuetext={ariaText()}
		{onpointerdown}
		{onpointermove}
		{onpointerup}
		{onkeydown}
	>
		<!-- rail + the portion the handle has passed -->
		<div class="absolute top-[13px] right-0 left-0 h-0.5 bg-ink/20"></div>
		<div class="absolute top-[13px] left-0 h-0.5 bg-day-sea" style="width: {frac * 100}%"></div>

		<!-- faint 3-hourly ruler; day boundaries drawn stronger below -->
		{#each Array(total) as _, s (s)}
			{#if s % STEPS !== 0}
				<span
					class="absolute top-[10px] h-1.5 w-px bg-ink/15"
					style="left: {(s / (total - 1)) * 100}%"
				></span>
			{/if}
		{/each}

		<!-- day gridlines + day-of-month labels -->
		{#each dayTicks as t (t.i)}
			<span
				class={['absolute top-[8px] h-[11px] w-px', t.i === dayIndex ? 'bg-ink' : 'bg-ink/45']}
				style="left: {t.frac * 100}%"
			></span>
			<span
				class={[
					'absolute top-[23px] flex -translate-x-1/2 flex-col items-center leading-none',
					t.i === dayIndex ? 'font-bold opacity-100' : 'opacity-55'
				]}
				style="left: {t.frac * 100}%"
			>
				<span class="text-xs tabular-nums">{t.dom}</span>
				{#if t.mon}
					<span class="mt-0.5 text-[9px] tracking-[0.08em]">{t.mon}</span>
				{/if}
			</span>
		{/each}

		<!-- live-now marker (hidden when the handle already sits on it) -->
		{#if !isLive && nowStep >= 0 && nowStep < total}
			<span
				class="absolute top-[7px] h-[13px] w-px bg-sun-gold"
				style="left: {nowFrac * 100}%"
				aria-hidden="true"
			></span>
		{/if}

		<!-- draggable handle -->
		<span
			class="handle absolute top-[9px] -ml-[6px] h-3 w-3 bg-sun-gold shadow-[0_0_0_2px_var(--color-ink),2px_2px_0_2px_color-mix(in_srgb,var(--color-navy)_45%,transparent)]"
			style="left: {frac * 100}%"
		></span>
	</div>

	<!-- always rendered (disabled when live) so toggling never shifts the layout -->
	<PixelButton
		size="xs"
		cap="gold"
		disabled={isLive}
		aria-label="Jump to now"
		class="shrink-0 disabled:pointer-events-none disabled:opacity-35"
		onclick={onnow}>NOW</PixelButton
	>
</div>
