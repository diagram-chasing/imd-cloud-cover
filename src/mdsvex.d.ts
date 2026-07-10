// mdsvex content files (.md/.svx) import as Svelte components.
declare module '*.md' {
	import type { Component } from 'svelte';
	const content: Component;
	export default content;
}

declare module '*.svx' {
	import type { Component } from 'svelte';
	const content: Component;
	export default content;
}
