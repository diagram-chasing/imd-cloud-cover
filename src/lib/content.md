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

Every morning the India Meteorological Department publishes a GFS _meteogram_ for each of its ~1,200 observation stations.

The Indian Meteorological Department (IMD) publishes a dense, complex data product called a **meteogram**. While it can be overwhelming at first glance, it packs a massive amount of information into a single image, which makes it a very useful tool for forecasters, power grid operators, and anyone tracking the weather.

A meteogram is a visual 10-day forecast broken down into three-hour intervals, stacked with vertical panels that track variables like temperature, humidity, and atmospheric pressure. With hundreds of on-ground weather stations scattered across India generating these graphics, the IMD can map out the weather at a granular level nationwide.

<div class="breakout">
	<MeteogramAtlas />
</div>

But what really caught my eye was how these graphics represent cloud cover. Look closely, and you’ll realize it’s actually drawn to look like a literal cloudy sky!

<CloudTiers />

The cloud coverage panel is essentially a stacked histogram divided into three distinct atmospheric tiers: low clouds (surface to 2 km), medium clouds (2 to 7 km), and high clouds (above 7 km). If a specific block of time is fully white, it means the station expects roughly 100% cloud coverage at that altitude. Since low clouds, like cumulus, are the ones that bring rain, a dense white block in the bottom tier usually correlates perfectly with a spike in the precipitation bar right above it.

I love this visualization. The fact that some developer, years ago, decided to map meteorological data in such a cute, pixel-art style feels like something straight out of Super Mario or Flappy Bird.

It appealed to me so much that a few months ago, I started archiving these every day. I wrote a script to analyse the pixels, turning the histogram images back into structured data so I could plot the current slice of time on a map. We now run this collection and analysis daily, gathering the data to map out India's 8-bit skies right at the top of this page.

A single day's map only tells you about today, though. Months of archived skies let us ask a longer question: which cities live under cloud, and which under sun?

{#if manifest && india}
<div class="breakout full-bleed">
	<CitySkyExplorer {manifest} {places} {india} />
</div>
{/if}

<div class="support-band">
	<SupportCTA />
</div>
