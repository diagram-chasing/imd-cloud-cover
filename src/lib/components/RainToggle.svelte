<script lang="ts">
	// Pixel icon toggle that mutes/unmutes the rain streak layer. Only mounted by
	// the caller when some station actually reports rain, so it never sits dead on
	// screen. The glyph is a real pixel cloud (from the map's own mark atlas) with
	// hairline streaks beneath, so it reads as rain and matches the towers exactly.
	import { buildMarkAtlas } from '$lib/map/sprites';
	import { sky } from '$lib/state/sky.svelte';
	import { click } from '$lib/feedback';

	function icon(node: HTMLCanvasElement) {
		const ctx = node.getContext('2d')!;
		ctx.imageSmoothingEnabled = false;
		ctx.clearRect(0, 0, node.width, node.height);
		const cell = 2;
		const cloud = buildMarkAtlas(cell).get('low', 3, 0);
		const cw = cloud.wCells * cell;
		const ch = cloud.hCells * cell;
		const cx = Math.round((node.width - cw) / 2);
		const cy = 1;
		ctx.drawImage(cloud.canvas, cx, cy);
		// three hairline streaks falling from the cloud's underside, staggered
		ctx.fillStyle = '#9fc8ee';
		const baseY = cy + ch + 1;
		for (const [i, x] of [cx + 3, cx + Math.round(cw / 2), cx + cw - 4].entries()) {
			ctx.fillRect(x, baseY + (i === 1 ? 0 : 2), 1, 4);
		}
	}

	function toggle() {
		sky.rainOn = !sky.rainOn;
		click(sky.rainOn ? 'open' : 'select');
	}
</script>

<button
	class={[
		'rain-toggle grid cursor-pointer place-items-center transition-[opacity,background-color] duration-120 hover:bg-white/12',
		sky.rainOn ? 'pixel-frame-gold bg-sun-gold/18' : 'pixel-frame-white opacity-45 hover:opacity-90'
	]}
	role="switch"
	aria-checked={sky.rainOn}
	aria-label={sky.rainOn ? 'Hide rain' : 'Show rain'}
	title={sky.rainOn ? 'Hide rain' : 'Show rain'}
	onclick={toggle}
>
	<canvas
		class="glyph [image-rendering:pixelated]"
		width="28"
		height="24"
		use:icon
		aria-hidden="true"
	></canvas>
</button>

<style>
	.rain-toggle {
		width: 30px;
		height: 30px;
	}
	.glyph {
		width: 22px;
		height: auto;
		filter: drop-shadow(1px 1px 0 --alpha(var(--color-navy) / 60%));
	}
</style>
