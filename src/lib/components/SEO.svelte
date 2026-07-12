<script lang="ts">
	interface Author {
		name: string;
		link: string;
	}

	interface Props {
		canonicalUrl: string;
		seoTitle: string;
		seoDescription: string;
		shareTitle: string;
		shareDescription: string;
		shareImgPath: string;
		shareImgAlt?: string;
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
		shareImgAlt = '',
		publishTime = '',
		updateTime = '',
		authors = []
	}: Props = $props();

	const orgLdJson = {
		'@context': 'http://schema.org',
		'@type': 'Organization',
		'@id': 'https://diagramchasing.fun/#publisher',
		name: 'Diagram Chasing',
		url: 'https://diagramchasing.fun/'
	};

	let articleLdJson = $derived({
		'@context': 'http://schema.org',
		'@type': 'Article',
		headline: seoTitle,
		url: canonicalUrl,
		mainEntityOfPage: { '@type': 'WebPage', '@id': canonicalUrl },
		thumbnailUrl: shareImgPath,
		image: [{ '@context': 'http://schema.org', '@type': 'ImageObject', url: shareImgPath }],
		publisher: { '@id': 'https://diagramchasing.fun/#publisher' },
		copyrightHolder: { '@id': 'https://diagramchasing.fun/#publisher' },
		copyrightYear: new Date().getFullYear(),
		dateCreated: publishTime,
		datePublished: publishTime,
		dateModified: updateTime || publishTime,
		author: authors.map(({ name, link }) => ({ '@type': 'Person', name, url: link })),
		isAccessibleForFree: true,
		keywords: ['India', 'census', 'data visualization', 'history', 'infographics', 'demography']
	});
</script>

<svelte:head>
	<title>{seoTitle}</title>
	<meta name="description" content={seoDescription} />
	<link rel="canonical" href={canonicalUrl} />

	<meta property="og:url" content={canonicalUrl} />
	<meta property="og:type" content="article" />
	<meta property="og:title" content={shareTitle} />
	<meta property="og:description" content={shareDescription} />
	<meta property="og:image" content={shareImgPath} />
	<meta property="og:site_name" content="Diagram Chasing" />

	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={shareTitle} />
	<meta name="twitter:description" content={shareDescription} />
	<meta name="twitter:image" content={shareImgPath} />
	{#if shareImgAlt}
		<meta name="twitter:image:alt" content={shareImgAlt} />
	{/if}

	<!-- svelte-ignore hydration_html_changed -->
	{@html `<${'script'} type="application/ld+json">${JSON.stringify(orgLdJson)}</script>`}
	<!-- svelte-ignore hydration_html_changed -->
	{@html `<${'script'} type="application/ld+json">${JSON.stringify(articleLdJson)}</script>`}
</svelte:head>
