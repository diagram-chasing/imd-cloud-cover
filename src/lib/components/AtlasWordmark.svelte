<script lang="ts" module>
	// Title plate for the atlas: two equal lines of type with pixel cumulus
	// drifting through them — some behind the letters, one in front, so the
	// wordmark reads as type standing in a sky. Clouds are recoloured into the
	// page's ink/paper palette, same convention as PixelBalloon: white body,
	// ink outline, cloud-block shading.

	type CloudCell = { x: number; y: number; c: 'line' | 'body' | 'shade' };

	// Outline every perimeter cell in ink, shade the row above the base, leave
	// the rest white — the Mario-cloud treatment the map's cumulus uses, redrawn
	// for paper.
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

	// Two cumulus species: a two-lobed puff and a single dome.
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

	// Hand-placed against the type block (both lines centred on x=360, caps
	// 29–62 and 81–114): one dome dips behind the top of READING A, one grazes
	// its baseline at the right, and the lobed puff passes in front of the
	// first M of METEOGRAM.
	const BEHIND = [
		{ cells: DOME, x: 242, y: 18, s: 4 },
		{ cells: DOME, x: 470, y: 52, s: 3.5 }
	];
	const FRONT = [{ cells: LOBED, x: 186, y: 84, s: 5 }];
</script>

{#snippet puffs(clouds: { cells: CloudCell[]; x: number; y: number; s: number }[], base: number)}
	{#each clouds as cloud, i (i)}
		<g
			class="bob"
			style="animation-duration: {4.6 + (base + i) * 1.3}s; animation-delay: {-(base + i) * 2}s"
		>
			<g transform="translate({cloud.x} {cloud.y}) scale({cloud.s})">
				{#each cloud.cells as p (`${p.x},${p.y}`)}
					<rect class="c-{p.c}" x={p.x} y={p.y} width="1" height="1" />
				{/each}
			</g>
		</g>
	{/each}
{/snippet}

<h2 class="wordmark" aria-label="Reading a meteogram">
	<svg viewBox="0 0 720 130" aria-hidden="true">
		{@render puffs(BEHIND, 0)}
		<text class="line" x="360" y="62" text-anchor="middle">READING A</text>
		<text class="line" x="360" y="114" text-anchor="middle">METEOGRAM</text>
		{@render puffs(FRONT, 2)}
	</svg>
</h2>

<style>
	.wordmark {
		display: block;
		margin: 4.5rem auto 0;
		max-width: 760px;
		padding-inline: 16px;
	}
	svg {
		display: block;
		width: 100%;
		height: auto;
		shape-rendering: crispEdges;
		overflow: visible;
	}

	.line {
		font-family: var(--font-display);
		font-size: 46px;
		font-weight: 700;
		letter-spacing: 0.1em;
		fill: var(--ink);
	}

	/* clouds, recoloured for paper */
	.c-line {
		fill: var(--ink);
	}
	.c-body {
		fill: #fff;
	}
	.c-shade {
		fill: var(--cloud-block);
	}

	/* The bob wrapper carries no transform attribute, so the CSS animation
	   owns the property; the inner g does the placing and scaling. */
	.bob {
		animation: bob 5s ease-in-out infinite alternate;
	}
	@keyframes bob {
		to {
			transform: translateY(2px);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.bob {
			animation: none;
		}
	}
</style>
