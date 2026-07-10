<script lang="ts" module>
	// 11×11 pixel icons authored as string grids ('#' = pixel), same idiom as the
	// map's sprite data. Rendered as SVG rects with crispEdges so they stay sharp
	// at any size.
	const ICONS: Record<string, string[]> = {
		clock: [
			'...#####...',
			'..#.....#..',
			'.#.......#.',
			'#....#....#',
			'#....#....#',
			'#....###..#',
			'#.........#',
			'#.........#',
			'.#.......#.',
			'..#.....#..',
			'...#####...'
		],
		download: [
			'....###....',
			'....###....',
			'....###....',
			'..#######..',
			'...#####...',
			'....###....',
			'.....#.....',
			'...........',
			'##.......##',
			'#.........#',
			'###########'
		],
		crop: [
			'###.....###',
			'#.........#',
			'#.........#',
			'...........',
			'....###....',
			'....#.#....',
			'....###....',
			'...........',
			'#.........#',
			'#.........#',
			'###.....###'
		],
		tower: [
			'....####...',
			'...######..',
			'...........',
			'..#######..',
			'..#######..',
			'...........',
			'.#########.',
			'.#########.',
			'...........',
			'###########',
			'...........'
		]
	};

	function iconRects(name: string): { x: number; y: number }[] {
		const out: { x: number; y: number }[] = [];
		ICONS[name].forEach((row, y) => {
			for (let x = 0; x < row.length; x++) if (row[x] === '#') out.push({ x, y });
		});
		return out;
	}
</script>

<script lang="ts">
	// The scrape→map pipeline as four plaques joined by a dashed flight trail.
	// Step copy is condensed from the methodology prose below it.
	const steps = [
		{ icon: 'clock', label: '11:00 IST', text: 'A daily GitHub Action runs every morning.' },
		{
			icon: 'download',
			label: 'Download',
			text: 'Every station’s meteogram — all ~1,200 of them.'
		},
		{
			icon: 'crop',
			label: 'Pixel-extract',
			text: 'The cloud-cover panel, keeping only the day-0 slice.'
		},
		{
			icon: 'tower',
			label: 'Aggregate',
			text: 'Three bands, rolled up into the static JSON views this site loads.'
		}
	];
</script>

<ol class="pipeline">
	{#each steps as s, i (s.label)}
		<li class="step" class:first={i === 0}>
			<svg class="icon" viewBox="0 0 11 11" width="44" height="44" aria-hidden="true">
				{#each iconRects(s.icon) as p (`${p.x},${p.y}`)}
					<rect x={p.x} y={p.y} width="1" height="1" />
				{/each}
			</svg>
			<h3 class="label">{s.label}</h3>
			<p class="text">{s.text}</p>
		</li>
	{/each}
</ol>

<style>
	.pipeline {
		list-style: none;
		display: flex;
		align-items: stretch;
		gap: 22px;
		max-width: 980px;
		margin: 0 auto;
		padding: 0;
		counter-reset: step;
	}
	.step {
		position: relative;
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 18px 14px 16px;
		text-align: center;
		background: var(--paper);
		border: 2px solid var(--ink);
		box-shadow: 4px 4px 0 var(--cloud-block);
		counter-increment: step;
	}
	/* Dashed flight trail joining the plaques, at mid-icon height. */
	.step:not(.first)::before {
		content: '';
		position: absolute;
		top: 40px;
		left: -24px;
		width: 24px;
		border-top: 2px dashed var(--ink);
		opacity: 0.45;
	}
	/* Step number, stamped on the plaque's top-left corner. */
	.step::after {
		content: counter(step, decimal-leading-zero);
		position: absolute;
		top: -2px;
		left: -2px;
		padding: 2px 6px 1px;
		background: var(--ink);
		color: var(--paper);
		font-family: var(--font-display);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.06em;
		line-height: 1.4;
	}
	.icon {
		shape-rendering: crispEdges;
	}
	.icon rect {
		fill: var(--ink);
	}
	.label {
		margin: 0;
		font-family: var(--font-display);
		font-size: 13px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.text {
		margin: 0;
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--muted-foreground);
		text-wrap: pretty;
	}
	@media (max-width: 820px) {
		.pipeline {
			flex-direction: column;
			align-items: stretch;
			gap: 26px;
			max-width: 380px;
		}
		.step:not(.first)::before {
			top: -28px;
			left: 50%;
			width: 0;
			height: 26px;
			border-top: none;
			border-left: 2px dashed var(--ink);
		}
	}
</style>
