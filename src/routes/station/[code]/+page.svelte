<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import {
		fetchStations,
		fetchLatest,
		fetchSummary,
		fetchRollup,
		fetchHistory,
		fetchForecast,
		meteogramImageUrl
	} from '$lib/api/r2';
	import type {
		StationsManifest,
		AllStations,
		Summary,
		Rollup,
		History,
		Forecast,
		Station
	} from '$lib/types';
	import { CLEAR_STARS, CLOUDY_DAY } from '$lib/theme';
	import {
		dayShape,
		headline,
		rankToday,
		ordinal,
		todClimatology,
		records,
		rainDays,
		longestClearRun,
		vsNorm,
		vsNation,
		shortDate,
		longDate,
		STEP_LABELS
	} from '$lib/station-facts';
	import DayStrip from '$lib/components/station/DayStrip.svelte';
	import StationMeteogram from '$lib/components/StationMeteogram.svelte';

	let code = $derived(page.params.code?.toUpperCase() ?? '');

	let manifest = $state<StationsManifest>();
	let latest = $state<AllStations>();
	let summary = $state<Summary>();
	let rollup = $state<Rollup>();
	let history = $state<History | null>(null);
	let forecast = $state<Forecast | null>(null);
	let error = $state<string | null>(null);

	onMount(async () => {
		try {
			[manifest, latest, summary, rollup] = await Promise.all([
				fetchStations(),
				fetchLatest(),
				fetchSummary(),
				fetchRollup('30d')
			]);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load station data';
		}
	});

	// Per-station files follow the code (history is optional, forecast too).
	$effect(() => {
		history = null;
		forecast = null;
		const c = code;
		if (!c) return;
		fetchHistory(c)
			.then((h) => {
				if (c === code) history = h;
			})
			.catch(() => {});
		const d = summary?.date;
		if (!d) return;
		fetchForecast(d, c)
			.then((f) => {
				if (c === code) forecast = f;
			})
			.catch(() => {});
	});

	let station = $derived<Station | null>(manifest ? (manifest.stations[code] ?? null) : null);
	let date = $derived(summary?.date ?? '');

	// --- Today ---------------------------------------------------------------
	let bandsToday = $derived(latest?.stations[code] ?? null);
	let shape = $derived(bandsToday ? dayShape(bandsToday) : null);
	let head = $derived(shape ? headline(shape) : null);
	let rank = $derived(latest && bandsToday ? rankToday(latest, code) : null);

	// --- The record ------------------------------------------------------------
	let tod = $derived(history && date ? todClimatology(history, 30, date) : null);
	let rec = $derived(history ? records(history) : null);
	let longestClear = $derived(history ? longestClearRun(history) : 0);

	let recordDays = $derived(history ? Object.keys(history.days).length : 0);

	// Current calendar-consecutive streak, walking back from the latest date.
	let streak = $derived.by(() => {
		if (!history || !date) return null;
		const walk = (cond: (e: number) => boolean) => {
			let n = 0;
			const d = new Date(date + 'T00:00:00Z');
			for (;;) {
				const dm = history!.days[d.toISOString().slice(0, 10)];
				if (!dm || !cond(dm.e)) break;
				n++;
				d.setUTCDate(d.getUTCDate() - 1);
			}
			return n;
		};
		const clear = walk((e) => e < CLEAR_STARS);
		if (clear > 0) return { kind: 'clear' as const, days: clear };
		const cloud = walk((e) => e >= CLOUDY_DAY);
		if (cloud > 0) return { kind: 'overcast' as const, days: cloud };
		return null;
	});

	// --- Sky calendar (30d) ----------------------------------------------------
	const CAL_ROWS: { key: 'e' | 'h' | 'm' | 'l'; label: string }[] = [
		{ key: 'e', label: 'SKY' },
		{ key: 'h', label: 'H' },
		{ key: 'm', label: 'M' },
		{ key: 'l', label: 'L' }
	];
	let series = $derived(rollup?.stations[code] ?? null);

	// --- Sharing -----------------------------------------------------------------
	let copied = $state<'link' | 'text' | null>(null);
	async function copy(kind: 'link' | 'text') {
		const url = `${location.origin}/station/${code}`;
		const text =
			kind === 'link' || !station || !head
				? url
				: `${station.name}, ${shortDate(date)} — ${head} ${url}`;
		try {
			await navigator.clipboard.writeText(text);
			copied = kind;
			setTimeout(() => (copied = null), 1500);
		} catch {
			copied = null;
		}
	}

	let metaDescription = $derived(
		station && head
			? `${station.name}: ${head} Daily cloud-cover almanac from IMD meteograms.`
			: 'Daily cloud-cover almanac for an IMD station.'
	);
</script>

<svelte:head>
	<title>{station?.name ?? code} — Reading the Clouds</title>
	<meta name="description" content={metaDescription} />
</svelte:head>

<main>
	<a class="back" href="/">← BACK TO THE MAP</a>

	{#if error}
		<p class="note">Couldn’t load this station: {error}</p>
	{:else if manifest && !station}
		<p class="note">No station “{code}”.</p>
	{:else if station && summary}
		<article>
			<!-- Masthead -->
			<header class="masthead">
				<p class="kicker">{longDate(date).toUpperCase()}</p>
				<h1>{station.name}</h1>
				<p class="dateline">
					{#if station.state}{station.state} ·
					{/if}{station.lat.toFixed(2)}°N {station.lon.toFixed(2)}°E
				</p>
			</header>

			{#if head}
				<p class="headline">{head}</p>
			{:else if latest}
				<p class="headline muted">No reading arrived from this station today.</p>
			{/if}

			<!-- Today's shape -->
			{#if bandsToday && shape}
				<section>
					<DayStrip
						bands={bandsToday}
						clearestIdx={shape.clearestIdx}
						cloudiestIdx={shape.cloudiestIdx}
					/>
					<p class="cap">
						TODAY · 3-HOURLY · IST — clearest around {STEP_LABELS[shape.clearestIdx]}, heaviest near {STEP_LABELS[
							shape.cloudiestIdx
						]}
					</p>
				</section>
			{/if}

			<!-- The ledger -->
			<section>
				<dl class="ledger">
					{#if rank}
						<div class="row">
							<dt>RANK</dt>
							<dd>
								<strong>{ordinal(rank.rank).toUpperCase()} CLEAREST</strong>
								<span class="sub"
									>of {rank.of.toLocaleString('en-IN')} stations reporting today</span
								>
							</dd>
						</div>
					{/if}

					{#if tod}
						<div class="row">
							<dt>DAILY RHYTHM</dt>
							<dd>
								{#if tod.spread >= 8}
									<strong>HEAVIEST AROUND {STEP_LABELS[tod.cloudiestIdx].toUpperCase()}</strong>
									<span class="sub">
										clearest near {STEP_LABELS[tod.clearestIdx]} · averaged over {tod.days}
										{tod.days === 1 ? 'day' : 'days'}
									</span>
								{:else}
									<strong>NO STRONG RHYTHM</strong>
									<span class="sub"
										>cover runs even through the day, over {tod.days}
										{tod.days === 1 ? 'day' : 'days'}</span
									>
								{/if}
							</dd>
						</div>
					{/if}
					{#if streak}
						<div class="row">
							<dt>STREAK</dt>
							<dd>
								<strong class:gold={streak.kind === 'clear'}>
									{streak.kind === 'clear' ? '☀' : '▦'}
									{streak.days}
									{streak.days === 1 ? 'DAY' : 'DAYS'}
									{streak.kind.toUpperCase()}
								</strong>
								{#if longestClear > 1}
									<span class="sub">longest clear run on record: {longestClear} days</span>
								{/if}
							</dd>
						</div>
					{/if}

					{#if rec && recordDays > 1}
						<div class="row">
							<dt>THE RECORD</dt>
							<dd>
								<strong>
									CLEAREST {shortDate(rec.clearest.date).toUpperCase()} · CLOUDIEST {shortDate(
										rec.cloudiest.date
									).toUpperCase()}
								</strong>
								<span class="sub">in {recordDays} days of record</span>
							</dd>
						</div>
					{/if}
				</dl>
			</section>

			<!-- Sky calendar -->
			{#if series && rollup}
				<section>
					<h2>CALENDAR</h2>
					{#each CAL_ROWS as r (r.key)}
						<div class="cal-row">
							<span class="cal-label">{r.label}</span>
							<div class="cells">
								{#each series[r.key] as v, i (i)}
									<span
										class="cal-cell"
										class:null={v === null}
										style={v === null ? '' : `background: rgba(255,255,255,${v / 100})`}
										title="{rollup.dates[i]}{v === null ? '' : ` · ${v}`}"
									></span>
								{/each}
							</div>
						</div>
					{/each}
					<p class="cap range">
						<span>{shortDate(rollup.dates[0]).toUpperCase()}</span>
						<span>DARK = CLEAR · WHITE = OVERCAST</span>
						<span>{shortDate(rollup.dates[rollup.dates.length - 1]).toUpperCase()}</span>
					</p>
				</section>
			{/if}

			<!-- Outlook -->
			<section>
				<h2>NEXT 10 DAYS</h2>
				<StationMeteogram {forecast} today={date} />
			</section>

			<footer class="links">
				<a href={meteogramImageUrl(date, code)} target="_blank" rel="noopener">RAW METEOGRAM ↗</a>
				<button onclick={() => copy('link')}>{copied === 'link' ? 'COPIED ✓' : 'COPY LINK'}</button>
			</footer>
		</article>
	{:else}
		<p class="note">Reading the skies…</p>
	{/if}
</main>

<style>
	main {
		max-width: 620px;
		margin: 0 auto;
		padding: 24px 20px 72px;
	}
	.back {
		display: inline-block;
		font-family: var(--font-display);
		font-size: 11px;
		letter-spacing: 0.05em;
		color: var(--ink);
		opacity: 0.7;
		text-decoration: none;
		margin-bottom: 28px;
	}
	.back:hover {
		opacity: 1;
	}
	.note {
		font-family: var(--font-display);
		font-size: 13px;
	}

	article {
		display: flex;
		flex-direction: column;
		gap: 36px;
	}

	.kicker {
		font-family: var(--font-display);
		font-size: 10px;
		letter-spacing: 0.14em;
		opacity: 0.6;
		margin: 0 0 8px;
	}
	h1 {
		font-family: var(--font-rough);
		font-size: clamp(30px, 7vw, 44px);
		line-height: 1.05;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		margin: 0;
	}
	.dateline {
		font-family: var(--font-display);
		font-size: 11px;
		letter-spacing: 0.08em;
		opacity: 0.65;
		margin: 6px 0 0;
	}

	.headline {
		font-style: italic;
		font-size: 20px;
		line-height: 1.4;
		margin: -8px 0 0;
		text-wrap: balance;
	}
	.headline.muted {
		opacity: 0.55;
	}

	section h2 {
		font-family: var(--font-display);
		font-size: 12px;
		letter-spacing: 0.12em;
		border-bottom: 1px solid var(--ink);
		padding-bottom: 4px;
		margin: 0 0 12px;
	}
	.cap {
		font-family: var(--font-display);
		font-size: 10px;
		letter-spacing: 0.05em;
		opacity: 0.6;
		margin: 8px 0 0;
	}
	.cap.range {
		display: flex;
		justify-content: space-between;
		gap: 8px;
	}

	.ledger {
		margin: 0;
	}
	.row {
		display: grid;
		grid-template-columns: 132px 1fr;
		gap: 12px;
		padding: 9px 0;
		border-bottom: 1px dashed rgba(11, 29, 58, 0.25);
	}
	.row:last-child {
		border-bottom: 0;
	}
	dt {
		font-family: var(--font-display);
		font-size: 14px;

		opacity: 0.55;
		padding-top: 3px;
	}
	dd {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	dd strong {
		font-family: var(--font-display);
		font-size: 15px;
		letter-spacing: 0.03em;
		font-weight: 700;
	}
	dd strong.gold {
		color: #b8860b;
	}
	.sub {
		font-size: 13px;
		opacity: 0.65;
	}

	/* Sky calendar, roomier than the map popover's. */
	.cal-row {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 3px;
	}
	.cal-label {
		font-family: var(--font-display);
		font-size: 10px;
		width: 26px;
		opacity: 0.6;
	}
	.cells {
		display: flex;
		gap: 1px;
		background: var(--ink);
		padding: 1px;
		flex: 1;
	}
	.cal-cell {
		flex: 1;
		height: 16px;
		background: rgba(255, 255, 255, 0);
	}
	.cal-cell.null {
		background-image: repeating-linear-gradient(
			45deg,
			#9aa7b4,
			#9aa7b4 2px,
			#c3ccd6 2px,
			#c3ccd6 4px
		);
	}

	.links {
		display: flex;
		gap: 20px;
		align-items: center;
	}
	.links a,
	.links button {
		font-family: var(--font-display);
		font-size: 11px;
		letter-spacing: 0.06em;
		color: var(--ink);
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.links a:hover,
	.links button:hover {
		color: var(--focus);
	}

	@media (max-width: 480px) {
		.row {
			grid-template-columns: 1fr;
			gap: 2px;
		}
		dt {
			padding-top: 0;
		}
	}
</style>
