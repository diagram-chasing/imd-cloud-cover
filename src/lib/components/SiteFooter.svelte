<script lang="ts">
	// Site footer in the map's pixel-boxed style: a "More from Us" grid of other
	// Diagram Chasing projects (from a committed RSS snapshot), the wordmark, page
	// links, social icons, and a copyright line. Adapted from
	// portrait-of-population's Footer into this project's ink/paper aesthetic.
	import rssFeedData from '$lib/data/rss-feed.json';
	import logo from '$lib/assets/images/log.png';

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
</script>

<footer class="site-footer">
	<div class="more">
		<h2 class="more-title">~ More From Us ~</h2>
		<div class="feed">
			{#each feedItems as item (item.link)}
				<a class="card" href={item.link} target="_blank" rel="noopener noreferrer">
					{#if item.image}
						<div class="thumb">
							<img src={item.image} alt={item.title} loading="lazy" />
						</div>
					{/if}
					<div class="body">
						<h3 class="card-title">{item.title}</h3>
						<p class="card-desc">{item.description}</p>
						<time class="card-date">{item.date}</time>
					</div>
				</a>
			{/each}
		</div>
	</div>

	<div class="colophon">
		<a
			class="brand bg-white"
			href="https://diagramchasing.fun"
			target="_blank"
			rel="noopener noreferrer"
			aria-label="Diagram Chasing — home"
		>
			<img src={logo} alt="Diagram Chasing" />
		</a>

		<ul class="pages">
			{#each pageLinks as link (link.href)}
				<li><a href={link.href} target="_blank" rel="noopener noreferrer">{link.name}</a></li>
			{/each}
		</ul>

		<ul class="socials">
			{#each socials as s (s.label)}
				<li>
					<a href={s.href} target="_blank" rel="noopener noreferrer" aria-label={s.label}>
						<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
							<path fill="currentColor" d={s.path} />
						</svg>
					</a>
				</li>
			{/each}
		</ul>

		<p class="copy">© {currentYear} Diagram Chasing</p>
	</div>
</footer>

<style>
	/* .site-footer {
		padding: 48px 20px 56px;
	} */

	.more {
		max-width: 640px;
		margin: 0 auto;
	}
	.more-title {
		margin: 0 0 24px;
		text-align: center;
		font-family: var(--font-display);
		font-size: 16px;
		font-weight: 400;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.feed {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 12px;
	}
	.card {
		display: flex;
		flex-direction: column;
		color: var(--ink);
		text-decoration: none;
		background: var(--paper);
		border: 2px solid var(--ink);
		transition:
			box-shadow 0.12s,
			transform 0.12s;
	}
	.card:hover {
		box-shadow: 4px 4px 0 var(--ink);
		transform: translate(-2px, -2px);
	}
	.thumb {
		height: 128px;
		overflow: hidden;
		border-bottom: 2px solid var(--ink);
	}
	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
		mix-blend-mode: multiply;
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 12px;
		flex: 1;
	}
	.card-title {
		margin: 0;
		font-family: var(--font-display);
		font-size: 14px;
		line-height: 1.35;
	}
	.card-desc {
		margin: 0;
		flex: 1;
		font-size: 12px;
		line-height: 1.55;
		color: var(--muted-foreground);
		text-wrap: pretty;
	}
	.card-date {
		font-size: 10px;
		letter-spacing: 0.04em;
		color: var(--muted-foreground);
		opacity: 0.75;
	}

	.colophon {
		margin-top: 56px;
		text-align: center;
	}
	.brand {
		display: inline-flex;
		padding: 8px 12px;
		border: 2px solid var(--ink);
		box-shadow: 3px 3px 0 var(--ink);
	}
	.brand img {
		height: 40px;
		width: auto;
		display: block;
	}
	.pages {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 6px 18px;
		list-style: none;
		margin: 22px 0 0;
		padding: 0;
	}
	.pages a {
		font-family: var(--font-display);
		font-size: 13px;
		letter-spacing: 0.04em;
		color: var(--ink);
		text-decoration: none;
		transition: color 0.12s;
	}
	.pages a:hover {
		color: var(--focus);
	}
	.socials {
		display: flex;
		justify-content: center;
		gap: 8px;
		list-style: none;
		margin: 18px 0 0;
		padding: 0;
	}
	.socials a {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		color: var(--ink);
		border: 2px solid transparent;
		transition:
			color 0.12s,
			border-color 0.12s;
	}
	.socials a:hover {
		color: var(--focus);
		border-color: var(--ink);
	}
	.copy {
		margin: 20px 0 0;
		font-family: var(--font-display);
		font-size: 11px;
		letter-spacing: 0.05em;
		color: var(--muted-foreground);
	}

	@media (max-width: 560px) {
		.feed {
			grid-template-columns: 1fr;
		}
	}
</style>
