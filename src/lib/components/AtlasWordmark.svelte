<script lang="ts" module>
	type CloudCell = { x: number; y: number; c: 'line' | 'body' | 'shade' };
	function outlined(pattern: number[][]): CloudCell[] {
		const rows = pattern.length;
		const at = (x: number, y: number) => (pattern[y]?.[x] ?? 0) === 1;
		const cells: CloudCell[] = [];
		pattern.forEach((row, y) =>
			row.forEach((v, x) => {
				if (!v) return;
				const edge = !at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || !at(x, y + 1);
				cells.push({ x, y, c: edge ? 'line' : y === rows - 2 ? 'shade' : 'body' });
			})
		);
		return cells;
	}

	const LOBED = outlined([
		[0, 0, 1, 1, 0, 1, 1, 0, 0],
		[0, 1, 1, 1, 1, 1, 1, 1, 0],
		[1, 1, 1, 1, 1, 1, 1, 1, 1],
		[1, 1, 1, 1, 1, 1, 1, 1, 1]
	]);
	const DOME = outlined([
		[0, 0, 1, 1, 1, 0, 0],
		[0, 1, 1, 1, 1, 1, 0],
		[1, 1, 1, 1, 1, 1, 1],
		[1, 1, 1, 1, 1, 1, 1]
	]);

	const BEHIND = [
		{ cells: DOME, x: 242, y: 18, s: 4 },
		{ cells: DOME, x: 470, y: 62, s: 3.5 }
	];
	const FRONT = [{ cells: LOBED, x: 186, y: 64, s: 5 }];
</script>

{#snippet puffs(clouds: { cells: CloudCell[]; x: number; y: number; s: number }[], base: number)}
	{#each clouds as cloud, i (i)}
		<g
			class="bob animate-bob motion-reduce:animate-none"
			style="animation-duration: {4.6 + (base + i) * 1.3}s; animation-delay: {-(base + i) * 2}s"
		>
			<g transform="translate({cloud.x} {cloud.y}) scale({cloud.s})">
				{#each cloud.cells as p (`${p.x},${p.y}`)}
					<rect
						class={p.c === 'line' ? 'fill-ink' : p.c === 'body' ? 'fill-white' : 'fill-cloud-block'}
						x={p.x}
						y={p.y}
						width="1"
						height="1"
					/>
				{/each}
			</g>
		</g>
	{/each}
{/snippet}

<h2 class="wordmark mx-auto mt-18 block max-w-[760px] px-4" aria-label="Reading a meteogram">
	<svg
		class="block h-auto w-full overflow-visible [shape-rendering:crispEdges]"
		viewBox="0 0 720 100"
		aria-hidden="true"
	>
		{@render puffs(BEHIND, 0)}
		<text
			class="line fill-ink font-bold tracking-widest"
			font-size="32"
			x="360"
			y="62"
			text-anchor="middle">READING A METEOGRAM</text
		>

		{@render puffs(FRONT, 2)}
	</svg>
</h2>
