<script lang="ts">
	import type { Station } from '$lib/types';

	interface Props {
		station: Station | null;
		values: { h: number; m: number; l: number } | null;
		clientX: number;
		clientY: number;
	}

	let { station, values, clientX, clientY }: Props = $props();

	// Flip near the right/bottom edges of the viewport.
	let style = $derived.by(() => {
		const flipX = clientX > window.innerWidth - 200;
		const flipY = clientY > window.innerHeight - 140;
		const x = flipX ? clientX - 12 : clientX + 12;
		const y = flipY ? clientY - 12 : clientY + 12;
		return `left:${x}px; top:${y}px; transform: translate(${flipX ? '-100%' : '0'}, ${
			flipY ? '-100%' : '0'
		});`;
	});

	const ROWS: { key: 'h' | 'm' | 'l'; label: string }[] = [
		{ key: 'h', label: 'H' },
		{ key: 'm', label: 'M' },
		{ key: 'l', label: 'L' }
	];
	// 6-cell bar filled by value/10 (rounded, capped at 6? bar is 60px = 6 cells of 10).
	function filled(v: number): number {
		return Math.round(v / 10);
	}
</script>

{#if station && values}
	<div class="tooltip" style={style} role="tooltip">
		<div class="name">{station.name}</div>
		{#if station.state}<div class="state">{station.state}</div>{/if}
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
		<div class="hint">CLICK FOR STATION →</div>
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
		min-width: 140px;
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
		margin-bottom: 6px;
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
		font-size: 10px;
		width: 10px;
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
	.hint {
		margin-top: 6px;
		font-family: var(--font-display);
		font-size: 8px;
		letter-spacing: 0.05em;
		opacity: 0.6;
	}
</style>
