<script lang="ts">
	import type { Summary, StreakEntry } from '$lib/types';

	interface Props {
		summary: Summary;
		onselect?: (code: string) => void;
	}
	let { summary, onselect }: Props = $props();

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
							<span class="days">{e.days} {e.days === 1 ? 'DAY' : 'DAYS'}</span>
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

<section class="streaks">
	{@render column('SUN STREAKS', summary.streaks.sun, 'sun')}
	{@render column('CLOUD STREAKS', summary.streaks.cloud, 'cloud')}
</section>

<style>
	.streaks {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 24px;
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
	@media (max-width: 640px) {
		.streaks {
			grid-template-columns: 1fr;
		}
	}
</style>
