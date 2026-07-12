<script>
	import CloudTiers from '$lib/components/CloudTiers.svelte';
	import MeteogramAtlas from '$lib/components/MeteogramAtlas.svelte';
	import SupportCTA from '$lib/components/SupportCTA.svelte';
	import CitySkyExplorer from '$lib/components/city/CitySkyExplorer.svelte';
	import SkyBarcode from '$lib/components/city/SkyBarcode.svelte';
	import cloudsUrl from '$lib/assets/clouds.jpg';
	import { fetchCities } from '$lib/api/r2';
	import { citySky } from '$lib/state/citySky.svelte';

	let { manifest = undefined, places = undefined, india = undefined } = $props();

	let cities = $state(null);
	$effect(() => {
		fetchCities()
			.then((d) => (cities = d))
			.catch(() => {});
	});


	let skyPair = $derived.by(() => {
		const code = citySky.code;
		if (!code || !cities) return null;
		const city = cities.cities[code];
		const twinCode = city?.twin?.alltime?.code;
		const twin = twinCode ? cities.cities[twinCode] : null;
		return city && twin
			? { city: city.name, twin: twin.name, cityE: city.e, twinE: twin.e }
			: null;
	});

	function shuffleTwin() {
		if (!cities) return;
		const pool = Object.keys(cities.cities).filter(
			(c) => c !== citySky.code && cities.cities[c].twin?.alltime?.code
		);
		if (pool.length) citySky.pick(pool[Math.floor(Math.random() * pool.length)]);
	}

	// Whole months spanned by the archived record, computed from the first and last
	// dates in the rollup so the prose stays accurate as the collection grows. Built
	// as a ready-to-print label here (rather than inline) so the markdown expression
	// stays a bare {monthsLabel} — quotes/backticks in prose get smart-quoted.
	let monthsLabel = $derived.by(() => {
		const dates = cities?.dates;
		if (!dates || dates.length < 2) return 'several months';
		const first = new Date(dates[0]);
		const last = new Date(dates[dates.length - 1]);
		const total = Math.max(
			1,
			(last.getFullYear() - first.getFullYear()) * 12 + (last.getMonth() - first.getMonth())
		);
		const plural = (n, unit) => n + ' ' + unit + (n === 1 ? '' : 's');
		if (total < 12) return plural(total, 'month');
		const years = Math.floor(total / 12);
		const months = total % 12;
		return months ? plural(years, 'year') + ' ' + plural(months, 'month') : plural(years, 'year');
	});
</script>

# Mapping Clouds with Meteograms

<p class="dek">A daily pixel map of the sky.</p>

<p class="byline">by <a href="https://diagramchasing.fun" target="_blank" rel="noopener">Aman Bhargava</a></p>

Every morning, the India Meteorological Department publishes a meteogram for each of its ~1,200 weather stations. It is a 10-day forecast broken into three-hour intervals and stacked into vertical panels for temperature, humidity, pressure, wind, cloud and rain. At first it looks like a wall of lines. But start with one panel you can read, such as the daily rise and fall of temperature, and the others become easier to follow, since a change in one usually corresponds to a change in another.

Read together, the panels show both the weather you will feel that day and the atmospheric conditions behind it. Multiply that by all the stations and the IMD can map the country's weather at a remarkably granular level.

<div class="breakout">
	<MeteogramAtlas />
</div>

What first drew me to these charts was the density of the visual organization, which you rarely see. But the detail that caught my eye was the cloud-cover panel. Look closely and you can see it is drawn to resemble an actual cloudy sky!

<img
	src={cloudsUrl}
	alt="A strip of the meteogram's cloud-cover panel — chunky white pixel clouds drifting across a blue sky."
	loading="lazy"
	class="block w-full bg-white leading-none shadow-[6px_6px_0] shadow-cloud-block border-2 border-ink"
/>


The cloud-cover panel is a stacked histogram split into three tiers: low clouds (cumulus, surface to 2 km), medium clouds (altocumulus, 2 to 7 km), and high clouds (cirrus, above 7 km). When a block of time is fully white, the station expects close to 100% coverage at that altitude. Because rain generally comes from the lowest tier, a dense white block there usually lines up with a spike in the precipitation bar below it.

<CloudTiers />


I love this visualization. Whoever wrote the software took complex meteorological data and rendered it in a playful, cloudy pixel-art style, and the result is charming.
Since February 2026 I have been archiving these charts every day. I wrote a script that reads the pixels and turns the histogram images back into structured data, so I could plot a given slice of time onto a map. That collection and analysis now runs daily, mapping India's clouds at the top of this page.

With {monthsLabel} of data, some patterns start to show. Every city here has a twin, or a distant city whose skies cloud over and clear in similar ways.

{#if skyPair}
<p>Take <strong>{skyPair.city}</strong> and <strong>{skyPair.twin}</strong>, they are hundreds of kilometres apart, yet they move together as you can see in the day-by-day strips below show.</p>

<div class="breakout">
	<SkyBarcode
		dates={cities.dates}
		aName={skyPair.city}
		bName={skyPair.twin}
		aE={skyPair.cityE}
		bE={skyPair.twinE}
		onShuffle={shuffleTwin}
	/>
</div>
{/if}

Below are all {cities ? Object.keys(cities.cities).length : 424} cities, ordered from clear to cloudy. Look one up to see how cloudy it has been, over the long run and today, and to meet the distant city its sky most resembles.

{#if manifest && india}
<div class="breakout full-bleed">
	<CitySkyExplorer {manifest} {places} {india} />
</div>
{/if}

<div class="support-band">
	<SupportCTA />
</div>
