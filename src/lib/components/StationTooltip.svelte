<script lang="ts">
	import type { Station } from '$lib/types';
	import { rainTier } from '$lib/theme';
	import { prettyDate } from '$lib/format';
	import { skyCondition } from '$lib/summary';

	interface Props {
		station: Station | null;
		values: { h: number; m: number; l: number; p?: number } | null;
		clientX: number;
		clientY: number;
		/** Stations aggregated under the hovered mark (1 = a single station). */
		members?: number;
		/** Scrubbed ISO date being viewed. */
		date?: string;
		/** Scrub-aware time descriptor, e.g. "15:00 IST" or "DAILY MEAN". */
		when?: string;
	}

	let { station, values, clientX, clientY, members = 1, date, when }: Props = $props();

	// Flip near the right/bottom edges of the viewport.
	let style = $derived.by(() => {
		const flipX = clientX > window.innerWidth - 230;
		const flipY = clientY > window.innerHeight - 190;
		const x = flipX ? clientX - 12 : clientX + 12;
		const y = flipY ? clientY - 12 : clientY + 12;
		return `left:${x}px; top:${y}px; transform: translate(${flipX ? '-100%' : '0'}, ${
			flipY ? '-100%' : '0'
		});`;
	});

	// Row labels mirror the band legend so the tooltip and the toggle speak
	// the same language.
	const ROWS: { key: 'h' | 'm' | 'l'; label: string }[] = [
		{ key: 'h', label: 'HIGH · CIRRUS' },
		{ key: 'm', label: 'MID · ALTO' },
		{ key: 'l', label: 'LOW · CUMULUS' }
	];
	// 6-cell bar filled by value/10 (values run 0-100).
	function filled(v: number): number {
		return Math.round(v / 10);
	}

	// Plain-language read of the sky in NWS public sky-condition wording, then rain
	// when the precip signal clears the same floor the map's rain streaks use.
	let summary = $derived.by(() => {
		if (!values) return '';
		let s = skyCondition(values);
		const rain = rainTier(values.p ?? 0);
		if (rain === 1) s += ' · RAIN POSSIBLE';
		else if (rain === 2) s += ' · RAIN LIKELY';
		else if (rain === 3) s += ' · HEAVY RAIN';
		return s;
	});
</script>

{#if station && values}
	<div class="tooltip" style={style} role="tooltip">
		<div class="name">{station.name}</div>
		{#if station.state}<div class="state">{station.state}</div>{/if}
		{#if when}<div class="when">{[prettyDate(date), when].filter(Boolean).join(' · ')}</div>{/if}
		<div class="summary">{summary}</div>
		<div class="caption">% OF SKY COVERED, BY ALTITUDE</div>
		<div class="rows">
			{#each ROWS as row (row.key)}
				<div class="row">
					<span class="rlabel">{row.label}</span>
					<span class="bar" aria-hidden="true">
						{#each Array(6) as _, i (i)}
							<span class="seg" class:on={i < filled(values[row.key])}></span>
						{/each}
					</span>
					<span class="num">{values[row.key]}</span>
				</div>
			{/each}
		</div>
		{#if members > 1}
			<div class="agg">◆ MEAN OF {members} STATIONS — ZOOM TO SPLIT</div>
			<div class="hint">CLICK FOR NEAREST: {station.name} →</div>
		{:else}
			<div class="hint">CLICK FOR STATION DETAIL →</div>
		{/if}
	</div>
{/if}

<style>
	.tooltip {
		position: fixed;
		z-index: 40;
		pointer-events: none;
		background: var(--paper);
		color: var(--ink);
		box-shadow: 0 0 0 2px var(--ink);
		padding: 8px 10px;
		min-width: 190px;
		font-family: var(--font-body);
	}
	.name {
		font-family: var(--font-display);
		font-size: 12px;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}
	.state {
		font-size: 11px;
		opacity: 0.7;
	}
	.when {
		font-family: var(--font-display);
		font-size: 8px;
		letter-spacing: 0.05em;
		opacity: 0.55;
		margin-top: 3px;
	}
	.summary {
		font-family: var(--font-display);
		font-size: 10px;
		letter-spacing: 0.05em;
		margin-top: 4px;
	}
	.caption {
		font-family: var(--font-display);
		font-size: 8px;
		letter-spacing: 0.05em;
		opacity: 0.55;
		margin: 6px 0 4px;
	}
	.rows {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.rlabel {
		font-family: var(--font-display);
		font-size: 9px;
		letter-spacing: 0.03em;
		width: 74px;
	}
	.bar {
		display: flex;
		gap: 1px;
	}
	.seg {
		width: 9px;
		height: 8px;
		background: #d8e8f4;
	}
	.seg.on {
		background: var(--accent);
	}
	.num {
		font-family: var(--font-display);
		font-size: 10px;
		width: 22px;
		text-align: right;
	}
	.agg {
		margin-top: 6px;
		font-family: var(--font-display);
		font-size: 8px;
		letter-spacing: 0.05em;
		color: var(--accent);
	}
	.hint {
		margin-top: 4px;
		font-family: var(--font-display);
		font-size: 8px;
		letter-spacing: 0.05em;
		opacity: 0.6;
	}
</style>
