<script lang="ts">
	interface Author {
		name: string;
		link: string;
	}

	interface Props {
		/** Canonical absolute URL (origin + subpath). Also used for og:url. */
		canonicalUrl: string;
		/** <title> + og/twitter title fall back to this. */
		seoTitle: string;
		seoDescription: string;
		/** Social-card overrides; default to the SEO title/description. */
		shareTitle?: string;
		shareDescription?: string;
		/** Absolute URL of the 1200×630 share image. */
		shareImgPath: string;
		/** Optional animated GIF variant; replaces og:image when set (one tag only —
		 * Discord galleries multiple og:images). twitter:image stays on shareImgPath. */
		shareImgAnimatedPath?: string;
		shareImgAlt?: string;
		/** og:type — 'website' for tools/index pages, 'article' for stories. */
		ogType?: 'website' | 'article';
		siteName?: string;
		/** When set, the page is described as an Article (with these dates). */
		publishTime?: string;
		updateTime?: string;
		authors?: Author[];
	}

	let {
		canonicalUrl,
		seoTitle,
		seoDescription,
		shareTitle,
		shareDescription,
		shareImgPath,
		shareImgAnimatedPath = '',
		shareImgAlt = '',
		ogType = 'website',
		siteName = 'Diagram Chasing',
		publishTime = '',
		updateTime = '',
		authors = []
	}: Props = $props();

	let ogTitle = $derived(shareTitle ?? seoTitle);
	let ogDescription = $derived(shareDescription ?? seoDescription);

	const KEYWORDS = [
		'India',
		'clouds',
		'cloud cover',
		'weather',
		'IMD',
		'meteogram',
		'data visualization'
	];

	const orgLdJson = {
		'@context': 'https://schema.org',
		'@type': 'Organization',
		'@id': 'https://diagramchasing.fun/#publisher',
		name: 'Diagram Chasing',
		url: 'https://diagramchasing.fun/'
	};

	// Article when we have a publish date (stories); otherwise a plain WebPage.
	let pageLdJson = $derived(
		publishTime
			? {
					'@context': 'https://schema.org',
					'@type': 'Article',
					headline: seoTitle,
					description: seoDescription,
					url: canonicalUrl,
					mainEntityOfPage: { '@type': 'WebPage', '@id': canonicalUrl },
					thumbnailUrl: shareImgPath,
					image: [{ '@type': 'ImageObject', url: shareImgPath }],
					publisher: { '@id': 'https://diagramchasing.fun/#publisher' },
					copyrightHolder: { '@id': 'https://diagramchasing.fun/#publisher' },
					copyrightYear: new Date().getFullYear(),
					datePublished: publishTime,
					dateModified: updateTime || publishTime,
					author: authors.map(({ name, link }) => ({ '@type': 'Person', name, url: link })),
					isAccessibleForFree: true,
					keywords: KEYWORDS
				}
			: {
					'@context': 'https://schema.org',
					'@type': 'WebPage',
					name: seoTitle,
					description: seoDescription,
					url: canonicalUrl,
					image: shareImgPath,
					publisher: { '@id': 'https://diagramchasing.fun/#publisher' },
					isAccessibleForFree: true,
					keywords: KEYWORDS
				}
	);
</script>

<svelte:head>
	<title>{seoTitle}</title>
	<meta name="description" content={seoDescription} />
	<link rel="canonical" href={canonicalUrl} />

	<meta property="og:url" content={canonicalUrl} />
	<meta property="og:type" content={ogType} />
	<meta property="og:site_name" content={siteName} />
	<meta property="og:title" content={ogTitle} />
	<meta property="og:description" content={ogDescription} />
	<!-- single og:image only: Discord galleries multiple og:image tags. Scrapers
	     that don't animate the GIF fall back to its first frame; Twitter gets the
	     static JPG via twitter:image below. -->
	<meta property="og:image" content={shareImgAnimatedPath || shareImgPath} />
	{#if shareImgAnimatedPath}<meta property="og:image:type" content="image/gif" />{/if}
	{#if shareImgAlt}<meta property="og:image:alt" content={shareImgAlt} />{/if}

	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={ogTitle} />
	<meta name="twitter:description" content={ogDescription} />
	<meta name="twitter:image" content={shareImgPath} />
	{#if shareImgAlt}<meta name="twitter:image:alt" content={shareImgAlt} />{/if}

	<!-- svelte-ignore hydration_html_changed -->
	{@html `<${'script'} type="application/ld+json">${JSON.stringify(orgLdJson)}</script>`}
	<!-- svelte-ignore hydration_html_changed -->
	{@html `<${'script'} type="application/ld+json">${JSON.stringify(pageLdJson)}</script>`}
</svelte:head>
