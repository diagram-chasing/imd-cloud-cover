<script lang="ts">
	// Site footer in the map's pixel-boxed style: a "More from Us" grid of other
	// Diagram Chasing projects (from a committed RSS snapshot), the wordmark, page
	// links, social icons, and a copyright line. Adapted from
	// portrait-of-population's Footer into this project's ink/paper aesthetic.
	import rssFeedData from '$lib/data/rss-feed.json';
	import logo from '$lib/assets/images/log.png';
	import islandUrl from '$lib/assets/cards/world-map.png';
	import islandPortraitUrl from '$lib/assets/cards/world-map-portrait.png';

	// The "More From Us" section is a top-down RPG island (PixelMap palette).
	// Each project is a "city" pinned to a spot on the island — its card (with the
	// original thumbnail) sits above the pin, whose tip marks the exact location.
	// Desktop uses a wide island (one project per landmass, either side of the
	// river); mobile swaps to a tall portrait island with the projects stacked.
	// Each spot's %s MUST match the matching bake() call in tmp-bake-map.mjs.
	const citySpots = [
		{ x: 24, y: 80, mx: 42, my: 38 },
		{ x: 76, y: 64, mx: 58, my: 80 }
	];

	const currentYear = new Date().getFullYear();

	const pageLinks = [
		{ name: 'Home', href: 'https://diagramchasing.fun' },
		{ name: 'About', href: 'https://diagramchasing.fun/about' },
		{ name: 'Authors', href: 'https://diagramchasing.fun/authors' },
		{ name: 'Support', href: 'https://diagramchasing.fun/support' }
	];

	const socials = [
		{
			label: 'RSS Feed',
			href: 'https://diagramchasing.fun/rss.xml',
			path: 'M6.18 15.64a2.18 2.18 0 0 1 2.18 2.18C8.36 19 7.38 20 6.18 20C5 20 4 19 4 17.82a2.18 2.18 0 0 1 2.18-2.18M4 4.44A15.56 15.56 0 0 1 19.56 20h-2.83A12.73 12.73 0 0 0 4 7.27zm0 5.66a9.9 9.9 0 0 1 9.9 9.9h-2.83A7.07 7.07 0 0 0 4 12.93z'
		},
		{
			label: 'GitHub',
			href: 'https://github.com/diagram-chasing',
			path: 'M12 2A10 10 0 0 0 2 12c0 4.42 2.87 8.17 6.84 9.5c.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34c-.46-1.16-1.11-1.47-1.11-1.47c-.91-.62.07-.6.07-.6c1 .07 1.53 1.03 1.53 1.03c.87 1.52 2.34 1.07 2.91.83c.09-.65.35-1.09.63-1.34c-2.22-.25-4.55-1.11-4.55-4.92c0-1.11.38-2 1.03-2.71c-.1-.25-.45-1.29.1-2.64c0 0 .84-.27 2.75 1.02c.79-.22 1.65-.33 2.5-.33s1.71.11 2.5.33c1.91-1.29 2.75-1.02 2.75-1.02c.55 1.35.2 2.39.1 2.64c.65.71 1.03 1.6 1.03 2.71c0 3.82-2.34 4.66-4.57 4.91c.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2'
		},
		{
			label: 'Instagram',
			href: 'https://www.instagram.com/diagramchasing',
			path: 'M7.8 2h8.4C19.4 2 22 4.6 22 7.8v8.4a5.8 5.8 0 0 1-5.8 5.8H7.8C4.6 22 2 19.4 2 16.2V7.8A5.8 5.8 0 0 1 7.8 2m-.2 2A3.6 3.6 0 0 0 4 7.6v8.8C4 18.39 5.61 20 7.6 20h8.8a3.6 3.6 0 0 0 3.6-3.6V7.6C20 5.61 18.39 4 16.4 4zm9.65 1.5a1.25 1.25 0 0 1 1.25 1.25A1.25 1.25 0 0 1 17.25 8A1.25 1.25 0 0 1 16 6.75a1.25 1.25 0 0 1 1.25-1.25M12 7a5 5 0 0 1 5 5a5 5 0 0 1-5 5a5 5 0 0 1-5-5a5 5 0 0 1 5-5m0 2a3 3 0 0 0-3 3a3 3 0 0 0 3 3a3 3 0 0 0 3-3a3 3 0 0 0-3-3'
		},
		{
			label: 'LinkedIn',
			href: 'https://www.linkedin.com/company/diagram-chasing/',
			path: 'M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.32 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93zM6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37z'
		}
	];

	const feedItems = rssFeedData.items.map((item) => ({
		...item,
		date: new Date(item.pubDate).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		})
	}));

	// On touch devices (no hover) the desktop hover-to-expand can't work, so a
	// pin's card expands on the first tap and the link opens on the second.
	let openIndex = $state(-1);

	function onCityClick(e: MouseEvent, i: number) {
		// Hover-capable pointers (desktop) expand on hover — let the link work.
		if (window.matchMedia('(hover: hover)').matches) return;
		if (openIndex === i) return; // already open → this tap follows the link
		e.preventDefault();
		openIndex = i;
	}

	function onIslandClick(e: MouseEvent) {
		// Tapping bare map (not a pin/card) collapses any open card.
		if ((e.target as HTMLElement).classList.contains('island')) openIndex = -1;
	}
</script>

<!-- (The 48px 20px 56px padding was commented out in the original CSS, so none is applied.) -->
<footer class="site-footer">
	<div class="more mx-auto max-w-[640px]">
		<h2 class="more-title text-center text-base font-normal tracking-[0.08em] uppercase">
			~ More From Us ~
		</h2>
		<!-- Top-down island the projects are pinned onto. The PNG has a transparent
		     background, so paper shows through around the coast. Extra vertical margin
		     gives the plaques (which rise above their pins) room to overflow / clear the
		     section title. On phones the wide island doesn't fit, so we swap to the tall
		     portrait island (≤560px) with its own aspect ratio. -->
		<div
			class="island relative mx-auto mt-20 aspect-[384/128] max-w-[560px] bg-[image:var(--island-wide)] bg-contain bg-center bg-no-repeat [image-rendering:pixelated] max-[560px]:mt-5 max-[560px]:aspect-[128/224] max-[560px]:max-w-[280px] max-[560px]:bg-[image:var(--island-tall)]"
			style="--island-wide: url({islandUrl}); --island-tall: url({islandPortraitUrl})"
			onclick={onIslandClick}
			role="presentation"
		>
			{#each feedItems as item, i (item.link)}
				{@const spot = citySpots[i % citySpots.length]}
				<!-- A pinned city: the anchor point (left/top) is the pin's tip on the
				     ground; the plaque sits just above it, centred on the same spot.
				     Since touch has no hover, tapping a pin expands it in place
				     (data-open) and a second tap follows the link. -->
				<a
					class="city group absolute top-[var(--y)] left-[var(--x)] text-ink no-underline hover:z-20 focus-visible:z-20 focus-visible:outline-none max-[560px]:top-[var(--my)] max-[560px]:left-[var(--mx)] data-open:z-20"
					data-open={openIndex === i ? '' : undefined}
					href={item.link}
					target="_blank"
					rel="noopener noreferrer"
					onclick={(e) => onCityClick(e, i)}
					style="--x: {spot.x}%; --y: {spot.y}%; --mx: {spot.mx}%; --my: {spot.my}%"
				>
					<!-- Collapsed, the card is a compact marker (a thumbnail sliver + the
					     title); hovering/focusing/opening expands it to the full xs (20rem)
					     card. The `bottom` offset leaves clear air between pin and card. -->
					<div
						class="plaque absolute bottom-[34px] left-0 w-[208px] -translate-x-1/2 border-2 border-ink bg-paper shadow-[3px_3px_0] shadow-ink/28 transition-[width,box-shadow,transform] duration-160 ease-[ease] group-hover:w-[min(20rem,calc(100vw-32px))] group-hover:translate-x-[calc(-50%-1px)] group-hover:-translate-y-[3px] group-hover:shadow-[6px_6px_0] group-hover:shadow-ink group-focus-visible:w-[min(20rem,calc(100vw-32px))] group-focus-visible:translate-x-[calc(-50%-1px)] group-focus-visible:-translate-y-[3px] group-focus-visible:shadow-[6px_6px_0] group-focus-visible:shadow-ink group-data-open:w-[min(20rem,calc(100vw-32px))] group-data-open:translate-x-[calc(-50%-1px)] group-data-open:-translate-y-[3px] group-data-open:shadow-[6px_6px_0] group-data-open:shadow-ink"
					>
						{#if item.image}
							<!-- Collapsed shows a sliver of the thumbnail; reveal shows the full image. -->
							<div
								class="thumb h-14 overflow-hidden border-b-2 border-ink transition-[height] duration-160 ease-[ease] group-hover:h-[150px] group-focus-visible:h-[150px] group-data-open:h-[150px]"
							>
								<img
									src={item.image}
									alt={item.title}
									loading="lazy"
									class="block h-full w-full object-cover mix-blend-multiply"
								/>
							</div>
						{/if}
						<div class="body flex flex-col gap-1.5 px-3.5 pt-3 pb-3.5">
							<h3 class="card-title m-0 text-base leading-tight">{item.title}</h3>
							<!-- On the map the collapsed card hides its description + date;
							     hovering/focusing/opening the city reveals them. -->
							<p
								class="card-desc m-0 [display:none] overflow-hidden text-sm leading-normal text-pretty text-muted-foreground [-webkit-box-orient:vertical] [-webkit-line-clamp:3] group-hover:[display:-webkit-box] group-focus-visible:[display:-webkit-box] group-data-open:[display:-webkit-box]"
							>
								{item.description}
							</p>
							<time
								class="card-date hidden text-xs tracking-[0.04em] text-muted-foreground opacity-75 group-hover:block group-focus-visible:block group-data-open:block"
								>{item.date}</time
							>
						</div>
					</div>
					<svg
						class="pin absolute bottom-0 left-0 h-auto w-[15px] -translate-x-1/2 drop-shadow-[1px_2px_0] drop-shadow-ink/30 transition-transform duration-120 ease-[ease] group-hover:-translate-y-0.5 group-hover:scale-[1.08] group-focus-visible:-translate-y-0.5 group-focus-visible:scale-[1.08] group-data-open:-translate-y-0.5 group-data-open:scale-[1.08]"
						viewBox="0 0 12 17"
						aria-hidden="true"
					>
						<path
							d="M6 0C2.7 0 0 2.7 0 6c0 4.5 6 11 6 11s6-6.5 6-11C12 2.7 9.3 0 6 0Z"
							fill="var(--ink)"
							stroke="var(--paper)"
							stroke-width="1"
						/>
						<circle cx="6" cy="6" r="2.3" fill="var(--paper)" />
					</svg>
				</a>
			{/each}
		</div>
	</div>

	<div class="colophon mt-14 text-center">
		<a
			class="brand inline-flex border-2 border-ink bg-white px-3 py-2 shadow-[3px_3px_0] shadow-ink"
			href="https://diagramchasing.fun"
			target="_blank"
			rel="noopener noreferrer"
			aria-label="Diagram Chasing — home"
		>
			<img src={logo} alt="Diagram Chasing" class="block h-10 w-auto" />
		</a>

		<ul class="pages mt-[22px] flex flex-wrap justify-center gap-x-4.5 gap-y-1.5">
			{#each pageLinks as link (link.href)}
				<li>
					<a
						href={link.href}
						target="_blank"
						rel="noopener noreferrer"
						class="text-sm tracking-[0.04em] text-ink no-underline transition-colors duration-120 hover:text-focus"
						>{link.name}</a
					>
				</li>
			{/each}
		</ul>

		<ul class="socials mt-4.5 flex justify-center gap-2">
			{#each socials as s (s.label)}
				<li>
					<a
						href={s.href}
						target="_blank"
						rel="noopener noreferrer"
						aria-label={s.label}
						class="inline-flex h-[34px] w-[34px] items-center justify-center border-2 border-transparent text-ink transition-[color,border-color] duration-120 hover:border-ink hover:text-focus"
					>
						<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
							<path fill="currentColor" d={s.path} />
						</svg>
					</a>
				</li>
			{/each}
		</ul>

		<p class="copy mt-5 text-xs tracking-wider text-muted-foreground">
			© {currentYear} Diagram Chasing
		</p>
	</div>
</footer>
