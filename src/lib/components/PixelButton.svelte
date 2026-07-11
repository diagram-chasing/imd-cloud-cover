
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';

	type Props = (HTMLAnchorAttributes & HTMLButtonAttributes) & {
		href?: string;
		size?: 'md' | 'sm';
		cap?: 'gold' | 'paper' | 'sky';
		flat?: boolean;
		children: Snippet;
	};

	let {
		href,
		size = 'md',
		cap = 'gold',
		flat = false,
		class: className = '',
		children,
		...rest
	}: Props = $props();
</script>

{#if href}
	<a
		{href}
		class={[
			'pixel-btn',
			size === 'sm' && 'sm',
			cap === 'paper' && 'cap-paper',
			cap === 'sky' && 'cap-sky',
			flat && 'flat',
			className
		]}
		{...rest}
	>
		<span class="base" aria-hidden="true"></span>
		<span class="cap">
			<span class="face" aria-hidden="true"></span>
			<span class="label">{@render children()}</span>
		</span>
	</a>
{:else}
	<button
		type="button"
		class={[
			'pixel-btn',
			size === 'sm' && 'sm',
			cap === 'paper' && 'cap-paper',
			cap === 'sky' && 'cap-sky',
			flat && 'flat',
			className
		]}
		{...rest}
	>
		<span class="base" aria-hidden="true"></span>
		<span class="cap">
			<span class="face" aria-hidden="true"></span>
			<span class="label">{@render children()}</span>
		</span>
	</button>
{/if}

<style>
	.pixel-btn {
		--travel: 5px;
		--lip: 4px;
		--press: 4px;
		--base-top: 10px;
		--base-ring: 9px;
		--base-edge: 4px;
		--band-hi: 7px;
		--band-lo: 6px;
		--glint: linear-gradient(var(--cap-glint), var(--cap-glint)) 8px 3px / 16px 2px no-repeat;
		--pad: 9px 26px 11px;
		--corner: polygon(
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

		--cap-hi: var(--btn-cap-hi);
		--cap-face: var(--btn-cap);
		--cap-lo: var(--btn-cap-lo);
		--cap-glint: var(--btn-glint);
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

	.pixel-btn.sm {
		--travel: 3px;
		--lip: 3px;
		--press: 2px;
		--base-top: 6px;
		--base-ring: 5px;
		--base-edge: 2px;
		--band-hi: 4px;
		--band-lo: 3px;
		--glint: linear-gradient(var(--cap-glint), var(--cap-glint)) 5px 2px / 8px 2px no-repeat;
		--pad: 3px 10px 5px;
		--corner: polygon(
			0 4px,
			2px 4px,
			2px 2px,
			4px 2px,
			4px 0,
			calc(100% - 4px) 0,
			calc(100% - 4px) 2px,
			calc(100% - 2px) 2px,
			calc(100% - 2px) 4px,
			100% 4px,
			100% calc(100% - 4px),
			calc(100% - 2px) calc(100% - 4px),
			calc(100% - 2px) calc(100% - 2px),
			calc(100% - 4px) calc(100% - 2px),
			calc(100% - 4px) 100%,
			4px 100%,
			4px calc(100% - 2px),
			2px calc(100% - 2px),
			2px calc(100% - 4px),
			0 calc(100% - 4px)
		);
	}

	.pixel-btn.cap-paper {
		--cap-hi: var(--ink-on-dark);
		--cap-face: var(--paper);
		--cap-lo: var(--mist-200);
		--cap-glint: var(--ink-on-dark);
	}


	.pixel-btn.flat {
		--travel: 0px;
		--lip: 0px;
		--press: 1px;
	}
	.pixel-btn.flat .base {
		display: none;
	}


	.pixel-btn.cap-sky {
		--cap-hi: color-mix(in srgb, var(--navy) 55%, var(--day-sea));
		--cap-face: var(--navy);
		--cap-lo: var(--night-sky);
		--cap-glint: color-mix(in srgb, var(--navy) 45%, var(--ink-on-dark));
		--label-color: var(--ink-on-dark);
	}

	.cap,
	.face,
	.base,
	.base::before {
		clip-path: var(--corner);
	}

	.base {
		position: absolute;
		inset: var(--base-top) 0 0;
		background: var(--ink);
	}
	.base::before {
		content: '';
		position: absolute;
		inset: 2px;
		background: linear-gradient(
			to bottom,
			var(--paper) 0 calc(100% - var(--base-ring)),
			var(--steel-300) calc(100% - var(--base-ring)) calc(100% - var(--base-edge)),
			var(--steel-500) calc(100% - var(--base-edge))
		);
	}

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
			var(--glint),
			linear-gradient(
				to bottom,
				var(--cap-hi) 0 var(--band-hi),
				var(--cap-face) var(--band-hi) calc(100% - var(--band-lo)),
				var(--cap-lo) calc(100% - var(--band-lo))
			);
	}
	.label {
		position: relative;
		display: block;
		padding: var(--pad);
		color: var(--label-color, var(--ink));
	}

	.pixel-btn:hover .cap {
		transform: translateY(-1px);
	}

	.pixel-btn:active .cap,
	.pixel-btn[aria-pressed='true'] .cap,
	.pixel-btn[aria-checked='true'] .cap {
		transform: translateY(var(--press));
	}
</style>
