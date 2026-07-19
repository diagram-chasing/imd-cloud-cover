<script>
	import CloudTiers from '$lib/components/CloudTiers.svelte';
	import MeteogramAtlas from '$lib/components/MeteogramAtlas.svelte';
	import SupportCTA from '$lib/components/SupportCTA.svelte';
	import CitySkyExplorer from '$lib/components/city/CitySkyExplorer.svelte';
	import SkyBarcode from '$lib/components/city/SkyBarcode.svelte';
	import cloudsUrl from '$lib/assets/clouds.jpg';
	import { fetchCities, R2_BASE } from '$lib/api/r2';
	import { withStateTag } from '$lib/stations/labels';
	import { citySky } from '$lib/state/citySky.svelte';

	let { manifest = undefined, india = undefined } = $props();

	let cities = $state(null);
	// live satellite illustration is absent in sample mode; hide the figure on 404
	let skyImgOk = $state(true);
	$effect(() => {
		fetchCities()
			.then((d) => (cities = d))
			.catch(() => {});
	});


	// The intro barcode runs independently of the explorer's selection: it latches the
	// last focused city so it stays in sync while one is picked, but keeps showing that
	// city (or a default) when the explorer is cleared — the strip is always visible.
	let barcodeCode = $state(null);
	$effect(() => {
		if (citySky.code) barcodeCode = citySky.code;
	});

	function defaultCode() {
		if (!cities) return null;
		let best = null;
		for (const [code, c] of Object.entries(cities.cities)) {
			if (!c.twin?.alltime?.code) continue;
			if (!best || (c.pop ?? 0) > (cities.cities[best].pop ?? 0)) best = code;
		}
		return best;
	}

	let skyPair = $derived.by(() => {
		const code = barcodeCode ?? defaultCode();
		if (!code || !cities) return null;
		const city = cities.cities[code];
		const twinCode = city?.twin?.alltime?.code;
		const twin = twinCode ? cities.cities[twinCode] : null;
		return city && twin
			? {
					city: withStateTag(city.name, city.state),
					twin: withStateTag(twin.name, twin.state),
					cityE: city.e,
					twinE: twin.e
				}
			: null;
	});

	function shuffleTwin() {
		if (!cities) return;
		const cur = barcodeCode ?? defaultCode();
		const pool = Object.keys(cities.cities).filter(
			(c) => c !== cur && cities.cities[c].twin?.alltime?.code
		);
		if (pool.length) barcodeCode = pool[Math.floor(Math.random() * pool.length)];
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

<div class="breakout mb-4!">
	<MeteogramAtlas />
</div>

What first drew me to these charts was the density of the visual organization, which you rarely see in the data visualization we usually come across. But the detail that caught my eye was the cloud-cover panel. Look closely, and you can see it is drawn to resemble an actual cloudy sky!

<img
	src={cloudsUrl}
	alt="A strip of the meteogram's cloud-cover panel — chunky white pixel clouds drifting across a blue sky."
	loading="lazy"
	class="block w-full bg-white leading-none shadow-[6px_6px_0] shadow-cloud-block border-2 border-ink"
/>

The cloud-cover panel is a stacked histogram split into three tiers: low clouds (cumulus, surface to 2 km), medium clouds (altocumulus, 2 to 7 km), and high clouds (cirrus, above 7 km). When a block of time is fully white, the station expects close to 100% coverage at that altitude. Because rain generally comes from the lowest tier, a dense white block there usually lines up with a spike in the precipitation bar below it.

<CloudTiers />

I love this visualization. It's charming that the person who wrote the software took complicated weather data and made it look like cloudy, fun pixel art. Every day since February 2026, I have been archiving these charts. I wrote a script that reads the pixels and turns the histogram images back into structured data, so I could plot a given slice of time onto a map. The mapping of India's clouds at the top of this page is the result of that daily collection and analysis.

With {monthsLabel} of data, some patterns start to show. Every station here has a twin, or a distant station whose skies cloud over and clear in similar ways.

{#if skyPair}

<p>For example, <strong>{skyPair.city}</strong> and <strong>{skyPair.twin}</strong> are hundreds of kilometers apart, but the daily cloud strips below show that they move in sync.</p>

<div class="breakout">
	<SkyBarcode
		dates={cities.dates}
		aName={skyPair.city}
		bName={skyPair.twin}
		aE={skyPair.cityE}
		bE={skyPair.twinE}
		onShuffle={shuffleTwin}
		axis
	/>
</div>
{/if}

Below are {cities ? Object.keys(cities.cities).length : 536} of these stations, ordered from clear to cloudy. You can look up a station to see how cloudy it has been over time and today, and to see which faraway station the sky looks most like.

{#if manifest && india}

<div class="breakout full-bleed">
	<CitySkyExplorer {manifest} {india} />
</div>
{/if}

<section class="methodology">
	<h2>Methodology</h2>
	<p>We extract daily cloud coverage data by analysing meteograms for each weather station. Because the charts use a standard layout, we could isolate the cloud-cover section and sample 80 evenly spaced intervals across the timeline. The chart divides the sky into high, middle, and low altitude layers, representing cloud density with the height of white shading. By measuring how high this shading reaches in each band, we calculate the percentage of cloud cover. To an observer on the ground, the sky looks overcast if even one layer is full, so we define a station’s overall cloudiness using the highest percentage among its three recorded layers.</p>
	{#if skyImgOk}
	<figure class="method-figure">
		<img
			src={`${R2_BASE}/latest/sky.png`}
			alt="India's current cloud cover as seen by the INSAT-3DS satellite"
			loading="lazy"
			onerror={() => (skyImgOk = false)}
			class="block w-full bg-white leading-none shadow-[4px_4px_0] shadow-cloud-block border-2 border-ink"
		/>
		<figcaption>Clouds over India within the last hour, via ISRO’s INSAT-3DS satellite</figcaption>
	</figure>
	{/if}
	<p>Reading pixels from one chart can only get so close, so we check our numbers against other IMD sources. The rain on the map comes from the IMD’s own numeric forecasts, which we also use to catch and correct bad pixel readings. For "today’s sky", the map is refreshed every hour with real observations from the INSAT-3DS weather satellite and IMD’s ground observers. However, past days remain forecasts and are not corrected.</p>
	<p>Finally, to match distant stations with similar weather trends, we tracked how each station’s daily cloud cover shifted compared to its average, pairing locations at least 400 kilometres apart and in different states whose skies cleared and clouded similarly.</p>
	<p>Data and code for this project is available for reuse on <a href="https://github.com/diagram-chasing/imd-meteograms/">our Github</a>.</p>
</section>

<section class="methodology -mt-10">
	<h2>AI Declaration</h2>
	<p>No prose was written by AI. Nor were any graphics generated. For example, the cloud glyphs on the map were drawn pixel-by-pixel into <a href="https://www.asciiart.eu/ascii-draw-studio/app">ASCII Draw Studio</a> and then rendered here. The author did use Claude for coding help, so the internal logic, algorithms, and the scripts that turn charts into data and then the data into charts again may be partly LLM-written.</p>
</section>

<div class="support-band">
	<SupportCTA />
</div>
