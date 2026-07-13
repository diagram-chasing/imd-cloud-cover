<script lang="ts">
	// The catch-all error page — shown by the static fallback for any URL that
	// isn't a real route (and for load errors). A "question map": the India raster
	// with a lost marker adrift over it, plus routes back into the site.
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import groundDayUrl from '$lib/assets/ground/ground-day.png';
	import { fetchCities } from '$lib/api/r2';
	import { citySlugs } from '$lib/city/slug.js';

	// Sea framing above/below the land raster — mirrors TwinMap / Minimap.
	const V_SPAN = 1.1;
	const LAND_TOP = ((0.05 / V_SPAN) * 100).toFixed(3);
	const LAND_H = ((1 / V_SPAN) * 100).toFixed(3);

	let featured = $state<{ name: string; slug: string }[]>([]);
	onMount(async () => {
		try {
			const c = await fetchCities();
			const { slugByCode } = citySlugs(c.cities);
			featured = Object.entries(c.cities)
				.sort((a, b) => (b[1].pop ?? 0) - (a[1].pop ?? 0))
				.slice(0, 6)
				.map(([code, city]) => ({ name: city.name, slug: slugByCode[code] }));
		} catch {
			// Offline / no data: the map + primary links still stand on their own.
		}
	});

	let status = $derived(page.status || 404);
</script>

<svelte:head>
	<title>{status} — Off the map</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main>
	<div class="qmap" style="aspect-ratio: 1024 / {Math.round(1085 * V_SPAN)};" aria-hidden="true">
		<img
			class="land"
			src={groundDayUrl}
			alt=""
			style="top: {LAND_TOP}%; height: {LAND_H}%;"
		/>
		<span class="qmark animate-bob motion-reduce:animate-none">?</span>
	</div>

	<p class="kicker">ERROR {status}</p>
	<h1>OFF THE MAP</h1>
	<p class="lead">This page drifted off the map.</p>

	<nav class="primary">
		<a class="key" href="{base}/">← BACK TO THE MAP</a>
		<a class="quiet" href="{base}/#field-notes">READ THE STORY ↓</a>
	</nav>

	{#if featured.length}
		<section class="cities">
			<h2>OR VISIT A CITY</h2>
			<div class="chips">
				{#each featured as c (c.slug)}
					<a class="chip" href="{base}/city/{c.slug}">{c.name}</a>
				{/each}
			</div>
		</section>
	{/if}
</main>

<style>
	main {
		max-width: 520px;
		margin: 0 auto;
		padding: 48px 20px 80px;
		text-align: center;
	}

	/* Question map: day-sea backdrop, pixelated land raster, a bobbing "?" adrift. */
	.qmap {
		position: relative;
		width: min(320px, 78vw);
		margin: 0 auto 32px;
		overflow: hidden;
		background: var(--day-sea);
		box-shadow: 0 0 0 2px var(--ink);
	}
	.qmap .land {
		position: absolute;
		left: 0;
		width: 100%;
		object-fit: fill;
		opacity: 0.9;
		image-rendering: pixelated;
	}
	.qmark {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		font-family: var(--font-rough);
		font-size: clamp(64px, 20vw, 108px);
		font-weight: 700;
		color: var(--sun-gold);
		text-shadow: 2px 2px 0 --alpha(var(--color-navy) / 90%);
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
	.lead {
		font-size: 16px;
		opacity: 0.7;
		margin: 12px 0 0;
	}

	.primary {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		align-items: center;
		gap: 10px 20px;
		margin: 28px 0 0;
	}
	.key {
		font-family: var(--font-display);
		font-size: 12px;
		letter-spacing: 0.06em;
		color: var(--paper);
		background: var(--ink);
		padding: 9px 14px;
		box-shadow: 3px 3px 0 --alpha(var(--color-navy) / 35%);
		text-decoration: none;
	}
	.key:hover {
		background: var(--focus);
		color: var(--ink);
	}
	.quiet {
		font-family: var(--font-display);
		font-size: 12px;
		letter-spacing: 0.06em;
		color: var(--ink);
		opacity: 0.7;
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.quiet:hover {
		opacity: 1;
		color: var(--focus);
	}

	.cities {
		margin: 40px 0 0;
	}
	.cities h2 {
		font-family: var(--font-display);
		font-size: 10px;
		letter-spacing: 0.14em;
		opacity: 0.55;
		margin: 0 0 12px;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 8px;
	}
	.chip {
		font-family: var(--font-display);
		font-size: 12px;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		color: var(--ink);
		padding: 6px 11px;
		box-shadow: 0 0 0 1.5px var(--ink);
		text-decoration: none;
	}
	.chip:hover {
		background: var(--sun-gold);
	}
</style>
