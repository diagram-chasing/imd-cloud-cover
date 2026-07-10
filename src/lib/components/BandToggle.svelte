<script lang="ts">
	import { sky } from '$lib/state/sky.svelte';
	import { buildMarkAtlas } from '$lib/map/sprites';
	import type { BandKey } from '$lib/theme';

	interface Props {
		/** Lay the options in a row (phone dock) instead of a column. */
		horizontal?: boolean;
	}
	let { horizontal = false }: Props = $props();

	const BANDS: { band: BandKey; label: string; short: string }[] = [
		{ band: 'high', label: 'HIGH · CIRRUS', short: 'HIGH' },
		{ band: 'middle', label: 'MID · ALTO', short: 'MID' },
		{ band: 'low', label: 'LOW · CUMULUS', short: 'LOW' }
	];

	// Draw each band's actual tower-mark glyph, so the legend matches what the
	// map renders. The glyphs sit directly on the sky — same as on the map.
	function preview(node: HTMLCanvasElement, band: BandKey) {
		const atlas = buildMarkAtlas(4);
		const sprite = atlas.get(band, 4, 0);
		const ctx = node.getContext('2d')!;
		ctx.imageSmoothingEnabled = false;
		ctx.clearRect(0, 0, node.width, node.height);
		const w = sprite.wCells * 4;
		const h = sprite.hCells * 4;
		ctx.drawImage(
			sprite.canvas,
			Math.round((node.width - w) / 2),
			Math.round((node.height - h) / 2)
		);
		return {};
	}

	// ALL shows the full stack as it appears on the map: a whole tower, the
	// three bands drawn small and stacked high-to-low.
	function previewAll(node: HTMLCanvasElement) {
		const atlas = buildMarkAtlas(2);
		const ctx = node.getContext('2d')!;
		ctx.imageSmoothingEnabled = false;
		ctx.clearRect(0, 0, node.width, node.height);
		const rows: { band: BandKey; y: number }[] = [
			{ band: 'high', y: 0 },
			{ band: 'middle', y: 6 },
			{ band: 'low', y: 12 }
		];
		for (const { band, y } of rows) {
			const sprite = atlas.get(band, 4, 0);
			const w = sprite.wCells * 2;
			ctx.drawImage(sprite.canvas, Math.round((node.width - w) / 2), y);
		}
		return {};
	}
</script>

<!-- The legend IS the control: a radio list of the map's own cloud glyphs.
     Pick a band to isolate that layer; ALL restores the full stack. The pixel
     radio squares + hover wash are what make it read as clickable.
     Phone (horizontal): drop the radio square and let each option read as a
     small, minimal button — a hollow pixel outline that fills sun-gold when
     it's the live band. -->
<div
	class={['legend flex', horizontal ? 'flex-row items-center gap-1' : 'flex-col gap-px']}
	role="radiogroup"
	aria-label="Cloud layers"
>
	<button
		class={[
			'band all flex cursor-pointer items-center text-white transition-[opacity,background-color] duration-120 text-shadow-sky hover:bg-white/12 hover:opacity-100',
			horizontal
				? 'gap-[5px] px-[7px] py-1 shadow-[inset_0_0_0_1.5px] shadow-white/45'
				: 'gap-2 py-[3px] pr-1.5 pl-1',
			horizontal &&
				sky.focusBand === null &&
				'bg-sun-gold/18 shadow-[inset_0_0_0_1.5px] shadow-sun-gold'
		]}
		role="radio"
		aria-checked={sky.focusBand === null}
		onclick={() => (sky.focusBand = null)}
	>
		<!-- Pixel radio square: hollow at rest, sun-gold when the option is live. Hidden on phone. -->
		<span
			class={[
				'box h-2 w-2 flex-none shadow-[0_0_0_2px_white,1px_1px_0_2px_color-mix(in_srgb,var(--color-navy)_90%,transparent)]',
				horizontal && 'hidden',
				sky.focusBand === null && 'bg-sun-gold'
			]}
			aria-hidden="true"
		></span>
		<canvas
			class={[
				'swatch drop-shadow-[1px_1px_0] drop-shadow-navy/60 [image-rendering:pixelated]',
				horizontal && 'h-auto w-[30px]'
			]}
			width="44"
			height="18"
			use:previewAll
			aria-hidden="true"
		></canvas>
		<span class="label text-xs tracking-[0.06em]">ALL</span>
	</button>
	{#each BANDS as b (b.band)}
		<button
			class={[
				'band flex cursor-pointer items-center text-white transition-[opacity,background-color] duration-120 text-shadow-sky hover:bg-white/12 hover:opacity-100',
				horizontal
					? 'gap-[5px] px-[7px] py-1 shadow-[inset_0_0_0_1.5px] shadow-white/45'
					: 'gap-2 py-[3px] pr-1.5 pl-1',
				horizontal &&
					sky.focusBand === b.band &&
					'bg-sun-gold/18 shadow-[inset_0_0_0_1.5px] shadow-sun-gold',
				sky.focusBand !== null && sky.focusBand !== b.band && 'opacity-40'
			]}
			role="radio"
			aria-checked={sky.focusBand === b.band}
			onclick={() => (sky.focusBand = sky.focusBand === b.band ? null : b.band)}
		>
			<span
				class={[
					'box h-2 w-2 flex-none shadow-[0_0_0_2px_white,1px_1px_0_2px_color-mix(in_srgb,var(--color-navy)_90%,transparent)]',
					horizontal && 'hidden',
					sky.focusBand === b.band && 'bg-sun-gold'
				]}
				aria-hidden="true"
			></span>
			<canvas
				class={[
					'swatch drop-shadow-[1px_1px_0] drop-shadow-navy/60 [image-rendering:pixelated]',
					horizontal && 'h-auto w-[30px]'
				]}
				width="44"
				height="18"
				use:preview={b.band}
				aria-hidden="true"
			></canvas>
			<span class="label text-xs tracking-[0.06em]">{horizontal ? b.short : b.label}</span>
		</button>
	{/each}
</div>
