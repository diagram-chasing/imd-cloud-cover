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
	<div>
		<h3 class={[compact ? 'mb-[5px] text-xs tracking-[0.04em]' : 'mb-3 text-sm tracking-wider']}>
			{title}
		</h3>
		{#if entries.length === 0}
			<p class="text-sm opacity-60">No active streaks yet.</p>
		{:else}
			<ol class={['flex list-none flex-col', compact ? 'gap-[3px]' : 'gap-1.5']}>
				{#each entries as e, i (e.code)}
					<li>
						<button
							onclick={() => onselect?.(e.code)}
							class={[
								"grid w-full cursor-pointer grid-cols-[20px_1fr_auto] items-center text-left text-ink [grid-template-areas:'rank_name_days'_'rank_strip_strip'] hover:bg-ink/5",
								compact ? 'gap-x-[5px] gap-y-px px-0.5 py-px' : 'gap-x-2 gap-y-0.5 p-1'
							]}
						>
							<span class={['opacity-50 [grid-area:rank]', compact ? 'text-xs' : 'text-base']}
								>{i + 1}</span
							>
							<span
								class={[
									'text-xs uppercase [grid-area:name]',
									compact ? 'tracking-[0.02em]' : 'tracking-[0.03em]'
								]}>{e.name}</span
							>
							<span class="text-xs opacity-70 [grid-area:days]">
								{#if compact}{e.days}d{:else}{e.days} {e.days === 1 ? 'DAY' : 'DAYS'}{/if}
							</span>
							<span
								class={['flex gap-px [grid-area:strip]', compact ? 'mt-px' : 'mt-0.5']}
								aria-hidden="true"
							>
								{#each Array(blocks(e.days)) as _, b (b)}
									<span
										class={[
											compact ? 'h-1.5 w-[3px]' : 'h-2 w-1.5',
											kind === 'sun' ? 'bg-sun-gold' : 'bg-cloud-block'
										]}
									></span>
								{/each}
							</span>
						</button>
					</li>
				{/each}
			</ol>
		{/if}
	</div>
{/snippet}

<!-- Dense compact plaque stays two-column even on phones (the max-sm:grid-cols-1
     only applies to the non-compact board) so the in-world sea board stays short. -->
<section
	class={[
		'grid',
		compact
			? 'grid-cols-2 gap-[14px]'
			: stacked
				? 'grid-cols-1 gap-4'
				: 'grid-cols-2 gap-6 max-sm:grid-cols-1'
	]}
>
	{@render column('SUN STREAKS', top(summary.streaks.sun), 'sun')}
	{@render column('CLOUD STREAKS', top(summary.streaks.cloud), 'cloud')}
</section>
