<script lang="ts">
	// A segmented, tabbed switch: two-plus labelled options with a gold pill that
	// slides under the active one. Pixel-native navy chip, matching the floating
	// tags in the sky (see CloudHistogram's .tag).
	interface Option {
		value: string;
		label: string;
	}
	interface Props {
		options: Option[];
		value: string;
		onchange?: (value: string) => void;
		class?: string;
	}
	let { options, value = $bindable(), onchange, class: className = '' }: Props = $props();

	let activeIndex = $derived(Math.max(0, options.findIndex((o) => o.value === value)));

	function pick(o: Option) {
		if (o.value === value) return;
		value = o.value;
		onchange?.(o.value);
	}
</script>

<div
	class="tabswitch {className}"
	role="tablist"
	style="--count: {options.length}; --active: {activeIndex};"
>
	<span class="tabswitch__pill" aria-hidden="true"></span>
	{#each options as o (o.value)}
		<button
			type="button"
			role="tab"
			aria-selected={o.value === value}
			class="tabswitch__btn"
			class:is-active={o.value === value}
			onclick={() => pick(o)}
		>
			{o.label}
		</button>
	{/each}
</div>

<style>
	/* Everything is sized in em off this one font-size, so the switch scales as a
		whole. The clamp shrinks it fluidly on narrow screens (phones sit it beside
		the map) and settles at 16px from tablet up — mirroring the headline. */
	.tabswitch {
		position: relative;
		display: inline-grid;
		grid-auto-flow: column;
		grid-auto-columns: 1fr;
		padding: 0.55em;
		font-size: clamp(10px, 2.1vw, 16px);
		background: color-mix(in srgb, var(--color-navy) 84%, transparent);
		box-shadow: 2px 2px 0 color-mix(in srgb, var(--color-navy) 35%, transparent);
		user-select: none;
	}
	.tabswitch__pill {
		position: absolute;
		top: 0.2em;
		bottom: 0.2em;
		left: 0.2em;
		width: calc((100% - 0.4em) / var(--count));
		background: var(--color-sun-gold);
		transform: translateX(calc(var(--active) * 100%));
		transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	.tabswitch__btn {
		position: relative;
		z-index: 1;
		padding: 0.3em 0.95em;
		border: 0;
		background: none;
		cursor: pointer;
		font-family: inherit;
		font-size: 1em;
		font-weight: 900;
		letter-spacing: 0.14em;
		line-height: 1;
		text-transform: uppercase;
		white-space: nowrap;
		color: color-mix(in srgb, #fff 72%, transparent);
		transition: color 160ms ease;
	}
	.tabswitch__btn:hover {
		color: #fff;
	}
	.tabswitch__btn.is-active {
		color: var(--color-navy);
	}
	@media (prefers-reduced-motion: reduce) {
		.tabswitch__pill {
			transition: none;
		}
	}
</style>
