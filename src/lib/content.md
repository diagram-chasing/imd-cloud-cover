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

Every morning, the India Meteorological Department (IMD) publishes a GFS _meteogram_ for each of its roughly 1,200 observation stations. It's a dense, complex data product—overwhelming at first glance, but it packs an enormous amount of information into a single image, which makes it invaluable to forecasters, power-grid operators, and anyone tracking the weather.image.png

A meteogram is a visual 10-day forecast broken into three-hour intervals, stacked into vertical panels that each track a variable: temperature, humidity, atmospheric pressure, and more. With a station generating one of these graphics at hundreds of points across the country, the IMD can map India's weather at a remarkably granular level.

<div class="breakout">
	<MeteogramAtlas />
</div>

But what really caught my eye was how these graphics represent cloud cover. Look closely and you'll realize it's drawn to resemble a literal cloudy sky!

<img
	src={cloudsUrl}
	alt="A strip of the meteogram's cloud-cover panel — chunky white pixel clouds drifting across a blue sky."
	loading="lazy"
	class="block w-full bg-white leading-none shadow-[6px_6px_0] shadow-cloud-block border-2 border-ink"
/>


The cloud-cover panel is a stacked histogram split into three atmospheric tiers: low clouds (surface to 2 km), medium clouds (2–7 km), and high clouds (above 7 km). When a block of time is fully white, the station expects close to 100% coverage at that altitude. And since low clouds like cumulus are the ones that bring rain, a dense white block in the bottom tier usually lines up neatly with a spike in the precipitation bar just below it.

<CloudTiers />


I absolutely love this visualization. It’s charming that the original developer who wrote this software consciously chose to take complex meteorological data and render it in such a playful, cloudy pixel-art style. Since February 2026, I've been archiving these every day. I wrote a script to read the pixels, turning the histogram images back into structured data so I could plot the current slice of time onto a map. We now run that collection and analysis daily, mapping India's clouds at the top of this page.

Having {monthsLabel} of data let's us look at some patterns too. For example, every city here has a **twin**, or a faraway city whose clouds gather and clear in the same ways on some days.

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

Below are all {cities ? Object.keys(cities.cities).length : 424} cities, from the clear to cloudy. You can look one up to see how cloudy it's been, over the long run and just today, and meet the distant city its sky most resembles.

{#if manifest && india}
<div class="breakout full-bleed">
	<CitySkyExplorer {manifest} {places} {india} />
</div>
{/if}

<div class="support-band">
	<SupportCTA />
</div>
