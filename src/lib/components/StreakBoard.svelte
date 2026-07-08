<script lang="ts">
	import type { Summary, StreakEntry } from '$lib/types';

	interface Props {
		summary: Summary;
		onselect?: (code: string) => void;
		/** One column (SUN above CLOUD) — for the narrow in-map inset. */
		stacked?: boolean;
		/** Dense typography + terse "17d" days — for the small in-world sea plaque. */
		compact?: boolean;
		/** Show only the top N entries per column. */
		limit?: number;
	}
	let { summary, onselect, stacked = false, compact = false, limit }: Props = $props();

	function top(entries: StreakEntry[]): StreakEntry[] {
		return limit ? entries.slice(0, limit) : entries;
	}

	const CAP = 21;
	function blocks(n: number): number {
		return Math.min(n, CAP);
	}
</script>

{#snippet column(title: string, entries: StreakEntry[], kind: 'sun' | 'cloud')}
	<div class="col">
		<h3>{title}</h3>
		{#if entries.length === 0}
			<p class="empty">No active streaks yet.</p>
		{:else}
			<ol>
				{#each entries as e, i (e.code)}
					<li>
						<button onclick={() => onselect?.(e.code)}>
							<span class="rank">{i + 1}</span>
							<span class="name">{e.name}</span>
							<span class="days">
								{#if compact}{e.days}d{:else}{e.days} {e.days === 1 ? 'DAY' : 'DAYS'}{/if}
							</span>
							<span class="strip {kind}" aria-hidden="true">
								{#each Array(blocks(e.days)) as _, b (b)}
									<span class="blk"></span>
								{/each}
							</span>
						</button>
					</li>
				{/each}
			</ol>
		{/if}
	</div>
{/snippet}

<section class="streaks" class:stacked class:compact>
	{@render column('SUN STREAKS', top(summary.streaks.sun), 'sun')}
	{@render column('CLOUD STREAKS', top(summary.streaks.cloud), 'cloud')}
</section>

<style>
	.streaks {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 24px;
	}
	.streaks.stacked {
		grid-template-columns: 1fr;
		gap: 16px;
	}
	h3 {
		font-family: var(--font-display);
		font-size: 14px;
		letter-spacing: 0.05em;
		margin: 0 0 12px;
	}
	ol {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	li button {
		display: grid;
		grid-template-columns: 20px 1fr auto;
		grid-template-areas: 'rank name days' 'rank strip strip';
		align-items: center;
		gap: 2px 8px;
		width: 100%;
		text-align: left;
		padding: 4px;
		cursor: pointer;
		color: var(--ink);
	}
	li button:hover {
		background: rgba(11, 29, 58, 0.05);
	}
	.rank {
		grid-area: rank;
		font-family: var(--font-display);
		font-size: 16px;
		opacity: 0.5;
	}
	.name {
		grid-area: name;
		font-family: var(--font-display);
		font-size: 12px;
		letter-spacing: 0.03em;
		text-transform: uppercase;
	}
	.days {
		grid-area: days;
		font-family: var(--font-display);
		font-size: 11px;
		opacity: 0.7;
	}
	.strip {
		grid-area: strip;
		display: flex;
		gap: 1px;
		margin-top: 2px;
	}
	.blk {
		width: 6px;
		height: 8px;
	}
	.strip.sun .blk {
		background: var(--sun-gold);
	}
	.strip.cloud .blk {
		background: var(--cloud-block);
	}
	.empty {
		font-size: 13px;
		opacity: 0.6;
	}

	/* Dense in-world plaque: two tight columns, small type, terse day counts, mini
	   strips. Kept two-column even on phones (higher specificity than the query
	   below) so the sea board stays short. */
	.streaks.compact {
		grid-template-columns: 1fr 1fr;
		gap: 14px;
	}
	.streaks.compact h3 {
		font-size: 10px;
		letter-spacing: 0.04em;
		margin: 0 0 5px;
	}
	.streaks.compact ol {
		gap: 3px;
	}
	.streaks.compact li button {
		padding: 1px 2px;
		gap: 1px 5px;
	}
	.streaks.compact .rank {
		font-size: 11px;
	}
	.streaks.compact .name {
		font-size: 9px;
		letter-spacing: 0.02em;
	}
	.streaks.compact .days {
		font-size: 9px;
	}
	.streaks.compact .strip {
		margin-top: 1px;
	}
	.streaks.compact .blk {
		width: 3px;
		height: 6px;
	}

	@media (max-width: 640px) {
		.streaks {
			grid-template-columns: 1fr;
		}
	}
</style>
