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
</svelte:head>
{@render children()}
