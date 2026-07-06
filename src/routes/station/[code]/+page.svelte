<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { fetchStations, fetchLatest, fetchSummary, fetchRollup } from '$lib/api/r2';
	import { defaultTimeIndex } from '$lib/state/sky.svelte';
	import type { StationsManifest, AllStations, Summary, Rollup, Station } from '$lib/types';
	import StationPanel from '$lib/components/StationPanel.svelte';

	let code = $derived(page.params.code?.toUpperCase() ?? '');

	let manifest = $state<StationsManifest>();
	let latest = $state<AllStations>();
	let summary = $state<Summary>();
	let rollup = $state<Rollup>();
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

	let station = $derived<Station | null>(manifest ? (manifest.stations[code] ?? null) : null);
	let current = $derived.by(() => {
		if (!latest || !latest.stations[code]) return null;
		const b = latest.stations[code];
		const i = defaultTimeIndex();
		return { h: b.h[i] ?? 0, m: b.m[i] ?? 0, l: b.l[i] ?? 0 };
	});
</script>

<svelte:head>
	<title>{station?.name ?? code} — Aaj Ka Aasmaan</title>
</svelte:head>

<main>
	<a class="back" href="/">← BACK TO THE MAP</a>

	{#if error}
		<p class="error">{error}</p>
	{:else if manifest && !station}
		<p class="error">No station “{code}”.</p>
	{:else if station && summary}
		<StationPanel {code} {station} {current} rollup={rollup ?? null} date={summary.date} variant="page" />
	{:else}
		<p class="loading">Loading…</p>
	{/if}
</main>

<style>
	main {
		max-width: 640px;
		margin: 0 auto;
		padding: 20px;
	}
	.back {
		display: inline-block;
		font-family: var(--font-display);
		font-size: 11px;
		letter-spacing: 0.05em;
		color: var(--accent);
		text-decoration: none;
		margin-bottom: 20px;
	}
	.error,
	.loading {
		font-family: var(--font-display);
		font-size: 13px;
	}
</style>
