<!--
	Chunky pixel push-button: a sun-gold jelly cap sitting proud of a grey
	plinth, both outlined in ink with stepped "rounded" pixel corners. Colors
	come from the layout.css jelly tokens (btn-cap-hi/cap/lo, btn-glint) plus
	the shared ink/paper/steel palette. Renders an <a> when href is given,
	otherwise a <button>; pressing sinks the cap onto the plinth.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';

	type Props = (HTMLAnchorAttributes & HTMLButtonAttributes) & {
		href?: string;
		children: Snippet;
	};

	let { href, class: className = '', children, ...rest }: Props = $props();
</script>

{#if href}
	<a {href} class="pixel-btn {className}" {...rest}>
		<span class="base" aria-hidden="true"></span>
		<span class="cap">
			<span class="face" aria-hidden="true"></span>
			<span class="label">{@render children()}</span>
		</span>
	</a>
{:else}
	<button type="button" class="pixel-btn {className}" {...rest}>
		<span class="base" aria-hidden="true"></span>
		<span class="cap">
			<span class="face" aria-hidden="true"></span>
			<span class="label">{@render children()}</span>
		</span>
	</button>
{/if}

<style>
	.pixel-btn {
		/* How far the cap sits above the plinth, and how far the plinth
		   overhangs it on each side. */
		--travel: 5px;
		--lip: 4px;
		position: relative;
		display: inline-block;
		padding: 0 var(--lip) var(--travel);
		border: 0;
		background: none;
		cursor: pointer;
		text-decoration: none;
		user-select: none;
		touch-action: manipulation;
		-webkit-tap-highlight-color: transparent;
	}

	/* Stepped pixel corners shared by every layer; the 2px-inset .face reuses
	   the same polygon on its own box, which leaves a uniform ink border. */
	.cap,
	.face,
	.base,
	.base::before {
		clip-path: polygon(
			0 8px,
			2px 8px,
			2px 4px,
			4px 4px,
			4px 2px,
			8px 2px,
			8px 0,
			calc(100% - 8px) 0,
			calc(100% - 8px) 2px,
			calc(100% - 4px) 2px,
			calc(100% - 4px) 4px,
			calc(100% - 2px) 4px,
			calc(100% - 2px) 8px,
			100% 8px,
			100% calc(100% - 8px),
			calc(100% - 2px) calc(100% - 8px),
			calc(100% - 2px) calc(100% - 4px),
			calc(100% - 4px) calc(100% - 4px),
			calc(100% - 4px) calc(100% - 2px),
			calc(100% - 8px) calc(100% - 2px),
			calc(100% - 8px) 100%,
			8px 100%,
			8px calc(100% - 2px),
			4px calc(100% - 2px),
			4px calc(100% - 4px),
			2px calc(100% - 4px),
			2px calc(100% - 8px),
			0 calc(100% - 8px)
		);
	}

	/* The grey plinth the cap rests on: ink outline, paper top ring,
	   steel side wall. */
	.base {
		position: absolute;
		inset: 10px 0 0;
		background: var(--ink);
	}
	.base::before {
		content: '';
		position: absolute;
		inset: 2px;
		background: linear-gradient(
			to bottom,
			var(--paper) 0 calc(100% - 9px),
			var(--steel-300) calc(100% - 9px) calc(100% - 4px),
			var(--steel-500) calc(100% - 4px)
		);
	}

	/* The jelly cap: ink shell, banded sun-gold face, specular glint. */
	.cap {
		position: relative;
		z-index: 1;
		display: block;
		background: var(--ink);
		transition: transform 70ms linear;
	}
	.face {
		position: absolute;
		inset: 2px;
		background:
			linear-gradient(var(--btn-glint), var(--btn-glint)) 8px 3px / 16px 2px no-repeat,
			linear-gradient(
				to bottom,
				var(--btn-cap-hi) 0 7px,
				var(--btn-cap) 7px calc(100% - 6px),
				var(--btn-cap-lo) calc(100% - 6px)
			);
	}
	.label {
		position: relative;
		display: block;
		padding: 9px 26px 11px;
		color: var(--ink);
	}

	.pixel-btn:hover .cap {
		transform: translateY(-1px);
	}
	.pixel-btn:active .cap {
		transform: translateY(4px);
	}
</style>
