<script lang="ts">
	import { sky } from '$lib/state/sky.svelte';
	import { buildMarkAtlas } from '$lib/map/sprites';
	import type { BandKey } from '$lib/theme';

	interface Props {
		horizontal?: boolean;
	}
	let { horizontal = false }: Props = $props();

	const BANDS: { band: BandKey; label: string; short: string }[] = [
		{ band: 'high', label: 'HIGH · CIRRUS', short: 'HIGH' },
		{ band: 'middle', label: 'MID · ALTO', short: 'MID' },
		{ band: 'low', label: 'LOW · CUMULUS', short: 'LOW' }
	];


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


{#if horizontal}
	<div class="legend flex flex-row items-center gap-1" role="radiogroup" aria-label="Cloud layers">
		<button
			class={[
				'band all flex cursor-pointer items-center gap-[5px] px-1 py-px text-white transition-[opacity,background-color] duration-120 text-shadow-sky hover:bg-white/12 hover:opacity-100',
				sky.focusBand === null ? 'pixel-frame-gold bg-sun-gold/18' : 'pixel-frame-white'
			]}
			role="radio"
			aria-checked={sky.focusBand === null}
			onclick={() => (sky.focusBand = null)}
		>
			<canvas
				class="swatch h-auto w-[30px] drop-shadow-[1px_1px_0] drop-shadow-navy/60 [image-rendering:pixelated]"
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
					'band flex cursor-pointer items-center gap-[5px] px-1 py-px text-white transition-[opacity,background-color] duration-120 text-shadow-sky hover:bg-white/12 hover:opacity-100',
					sky.focusBand === b.band ? 'pixel-frame-gold bg-sun-gold/18' : 'pixel-frame-white',
					sky.focusBand !== null && sky.focusBand !== b.band && 'opacity-40'
				]}
				role="radio"
				aria-checked={sky.focusBand === b.band}
				onclick={() => (sky.focusBand = sky.focusBand === b.band ? null : b.band)}
			>
				<canvas
					class="swatch h-auto w-[30px] drop-shadow-[1px_1px_0] drop-shadow-navy/60 [image-rendering:pixelated]"
					width="44"
					height="18"
					use:preview={b.band}
					aria-hidden="true"
				></canvas>
				<span class="label text-xs tracking-[0.06em]">{b.short}</span>
			</button>
		{/each}
	</div>
{:else}
	<div class="legend flex flex-col gap-px" role="radiogroup" aria-label="Cloud layers">
		<button
			class="band all flex cursor-pointer items-center gap-2 py-[3px] pr-1.5 pl-1 text-white transition-[opacity,background-color] duration-120 text-shadow-sky hover:bg-white/12 hover:opacity-100"
			role="radio"
			aria-checked={sky.focusBand === null}
			onclick={() => (sky.focusBand = null)}
		>
			<span
				class={[
					'box h-2 w-2 flex-none shadow-[0_0_0_2px_white,1px_1px_0_2px_color-mix(in_srgb,var(--color-navy)_90%,transparent)]',
					sky.focusBand === null && 'bg-sun-gold'
				]}
				aria-hidden="true"
			></span>
			<canvas
				class="swatch drop-shadow-[1px_1px_0] drop-shadow-navy/60 [image-rendering:pixelated]"
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
					'band flex cursor-pointer items-center gap-2 py-[3px] pr-1.5 pl-1 text-white transition-[opacity,background-color] duration-120 text-shadow-sky hover:bg-white/12 hover:opacity-100',
					sky.focusBand !== null && sky.focusBand !== b.band && 'opacity-40'
				]}
				role="radio"
				aria-checked={sky.focusBand === b.band}
				onclick={() => (sky.focusBand = sky.focusBand === b.band ? null : b.band)}
			>
				<span
					class={[
						'box h-2 w-2 flex-none shadow-[0_0_0_2px_white,1px_1px_0_2px_color-mix(in_srgb,var(--color-navy)_90%,transparent)]',
						sky.focusBand === b.band && 'bg-sun-gold'
					]}
					aria-hidden="true"
				></span>
				<canvas
					class="swatch drop-shadow-[1px_1px_0] drop-shadow-navy/60 [image-rendering:pixelated]"
					width="44"
					height="18"
					use:preview={b.band}
					aria-hidden="true"
				></canvas>
				<span class="label text-xs tracking-[0.06em]">{b.label}</span>
			</button>
		{/each}
	</div>
{/if}
