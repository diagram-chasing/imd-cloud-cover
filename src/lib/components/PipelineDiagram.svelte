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

<ol
	class="pipeline mx-auto flex max-w-[980px] list-none items-stretch gap-[22px] p-0 max-[820px]:max-w-[380px] max-[820px]:flex-col max-[820px]:items-stretch max-[820px]:gap-[26px]"
>
	{#each steps as s, i (s.label)}
		<!-- Each plaque carries a dashed flight trail (::before) and a stamped
		     step number (::after) — see residual style; both need CSS counters
		     and pseudo-content, so they can't be utilities. -->
		<li
			class="step relative flex flex-1 flex-col items-center gap-2 border-2 border-ink bg-paper px-3.5 pt-[18px] pb-4 text-center shadow-[4px_4px_0] shadow-cloud-block"
			class:first={i === 0}
		>
			<svg
				class="icon [shape-rendering:crispEdges]"
				viewBox="0 0 11 11"
				width="44"
				height="44"
				aria-hidden="true"
			>
				{#each iconRects(s.icon) as p (`${p.x},${p.y}`)}
					<rect class="fill-ink" x={p.x} y={p.y} width="1" height="1" />
				{/each}
			</svg>
			<h3 class="label m-0 text-sm font-bold tracking-[0.08em] uppercase">{s.label}</h3>
			<p class="text m-0 text-xs leading-normal text-pretty text-muted-foreground">{s.text}</p>
		</li>
	{/each}
</ol>

<style>
	/* CSS counters + pseudo-element content are not expressible as utilities,
	   so the numbered plaque + dashed flight trail stay here. */
	.pipeline {
		counter-reset: step;
	}
	.step {
		counter-increment: step;
	}
	/* Dashed flight trail joining the plaques, at mid-icon height. */
	.step:not(.first)::before {
		content: '';
		position: absolute;
		top: 40px;
		left: -24px;
		width: 24px;
		border-top: 2px dashed var(--color-ink);
		opacity: 0.45;
	}
	/* Step number, stamped on the plaque's top-left corner. */
	.step::after {
		content: counter(step, decimal-leading-zero);
		position: absolute;
		top: -2px;
		left: -2px;
		padding: 2px 6px 1px;
		background: var(--color-ink);
		color: var(--color-paper);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.06em;
		line-height: 1.4;
	}
	@media (max-width: 820px) {
		.step:not(.first)::before {
			top: -28px;
			left: 50%;
			width: 0;
			height: 26px;
			border-top: none;
			border-left: 2px dashed var(--color-ink);
		}
	}
</style>
