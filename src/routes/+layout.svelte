<script lang="ts">
	import './layout.css';
	import { base } from '$app/paths';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} type="image/svg+xml" sizes="any" />
	<link rel="apple-touch-icon" href="{base}/apple-touch-icon.png" />
	<link rel="manifest" href="{base}/site.webmanifest" />
	<meta name="theme-color" content="#0B1D3A" />
	<!-- Standard.site: this project is a document of the Diagram Chasing publication -->
	<link rel="site.standard.publication" href="at://did:plc:pbzkofwfyokqzouibm2bcfo4/site.standard.publication/3mv3cvvqd72hd" />
	<link rel="site.standard.document" href="at://did:plc:pbzkofwfyokqzouibm2bcfo4/site.standard.document/3mv3cvxrsvkhb" />
</svelte:head>
{@render children()}
