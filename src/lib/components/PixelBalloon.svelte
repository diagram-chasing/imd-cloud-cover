<script lang="ts" module>

	const W = 15;
	const CX = 7;
	const HALF = [2, 3, 4, 5, 6, 7, 7, 7, 7, 6, 6, 5, 5, 4, 4, 3, 3, 2, 1];
	const SEAMS = [4, 7, 10];
	const ENV_H = HALF.length;
	const H = ENV_H + 6;

	interface Px {
		x: number;
		y: number;
		c: 'body' | 'line' | 'shade';
	}
	const PX: Px[] = [];
	HALF.forEach((h, y) => {
		const a = CX - h;
		const b = CX + h;
		for (let x = a; x <= b; x++) {
			let c: Px['c'] = 'body';
			if (x === a || x === b || SEAMS.includes(x)) c = 'line';
			else if (x > CX && ((x + y) & 1) === 0) c = 'shade';
			PX.push({ x, y, c });
		}
	});
	for (const y of [ENV_H, ENV_H + 1]) {
		PX.push({ x: CX - 1, y, c: 'line' }, { x: CX + 1, y, c: 'line' });
	}
	for (let y = ENV_H + 2; y <= ENV_H + 4; y++) {
		for (let x = CX - 1; x <= CX + 1; x++) {
			PX.push({ x, y, c: y === ENV_H + 2 ? 'body' : 'line' });
		}
	}
</script>

<script lang="ts">
	let { size = 28 }: { size?: number } = $props();
</script>

<svg
	class="balloon block animate-balloon-bob [shape-rendering:crispEdges] motion-reduce:animate-none"
	width={size}
	height={(size * H) / W}
	viewBox="0 0 {W} {H}"
	aria-hidden="true"
>
	{#each PX as p (`${p.x},${p.y}`)}
		<rect x={p.x} y={p.y} width="1" height="1" class={p.c} />
	{/each}
</svg>

<style>
	.body {
		fill: var(--balloon-body, var(--color-paper));
	}
	.line {
		fill: var(--balloon-line, var(--color-ink));
	}
	.shade {
		fill: var(--balloon-shade, var(--color-cloud-block));
	}
</style>
