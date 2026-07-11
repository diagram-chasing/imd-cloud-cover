<script>
	import CloudTiers from '$lib/components/CloudTiers.svelte';
	import MeteogramAtlas from '$lib/components/MeteogramAtlas.svelte';
	import SupportCTA from '$lib/components/SupportCTA.svelte';
	import CitySkyExplorer from '$lib/components/city/CitySkyExplorer.svelte';

	// Passed down from +page.svelte once the core data loads; the explorer
	// section below waits on them.
	let { manifest = undefined, places = undefined, india = undefined } = $props();
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

<CloudTiers />

The cloud-cover panel is a stacked histogram split into three atmospheric tiers: low clouds (surface to 2 km), medium clouds (2–7 km), and high clouds (above 7 km). When a block of time is fully white, the station expects close to 100% coverage at that altitude. And since low clouds like cumulus are the ones that bring rain, a dense white block in the bottom tier usually lines up neatly with a spike in the precipitation bar just above it.

I love this visualization. The fact that some developer, years ago, chose to render meteorological data in such a cute, pixel-art style feels like something out of Super Mario or Flappy Bird.

Since February 2026, I've been archiving these every day. I wrote a script to read the pixels, turning the histogram images back into structured data so I could plot the current slice of time onto a map. We now run that collection and analysis daily, mapping India's clouds at the top of this page.

Have you ever thought about which city has clouds that look like the ones you see? Below are all 424 cities, ranging from clear to cloudy. Look up a city, compare its average over a long period of time to its average just today, and then find the sky of the other city that it has looked most like over the same time period.

{#if manifest && india}
<div class="breakout full-bleed">
	<CitySkyExplorer {manifest} {places} {india} />
</div>
{/if}

<div class="support-band">
	<SupportCTA />
</div>
