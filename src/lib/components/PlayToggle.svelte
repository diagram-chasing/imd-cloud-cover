<script lang="ts">
	// Shared pixel-styled play/pause control used by the time + window scrubbers.
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { PlayIcon, PauseIcon } from '@hugeicons/core-free-icons';

	interface Props {
		playing: boolean;
		disabled?: boolean;
		/** aria-label shown in the "play" (paused) state. */
		label?: string;
		ontoggle: () => void;
	}
	let { playing, disabled = false, label = 'Play', ontoggle }: Props = $props();
</script>

<button
	class="play"
	aria-label={playing ? 'Pause' : label}
	aria-pressed={playing}
	{disabled}
	onclick={ontoggle}
>
	<!-- hugeicons captures `icon` once on mount; swap via altIcon/showAlt instead -->
	<HugeiconsIcon
		icon={PlayIcon}
		altIcon={PauseIcon}
		showAlt={playing}
		size={15}
		strokeWidth={2.75}
		aria-hidden="true"
	/>
</button>

<style>
	/* notched pixel corners + crisp shadow to match PixelButton */
	.play {
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
		display: grid;
		place-items: center;
		flex-shrink: 0;
		width: 26px;
		height: 26px;
		background: var(--color-sun-gold);
		color: var(--color-ink);
		box-shadow: 2px 2px 0 --alpha(var(--color-navy) / 45%);
		clip-path: var(--corner);
		cursor: pointer;
		transition: transform 70ms linear;
	}
	.play:hover {
		transform: translateY(-1px);
	}
	.play:active {
		transform: translateY(1px);
	}
	.play:disabled {
		cursor: not-allowed;
		opacity: 0.35;
	}
</style>
