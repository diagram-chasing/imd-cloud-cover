<script lang="ts" module>
	import { CLOUD, SKY } from '$lib/theme';
	import { makePattern, MARK_ALPHA, TIER_ALPHA } from '$lib/map/sprites';


	type Band = 'high' | 'middle' | 'low';


	const SCENE: Record<Band, { tier: number; variant: number; left: string; top: string; cell: number }[]> = {
		high: [
			{ tier: 4, variant: 0, left: '18%', top: '22%', cell: 8 },
			{ tier: 3, variant: 1, left: '6%', top: '48%', cell: 7 },
			{ tier: 3, variant: 2, left: '50%', top: '70%', cell: 7 }
		],
		middle: [
			{ tier: 4, variant: 0, left: '2%', top: '20%', cell: 8 },
			{ tier: 3, variant: 1, left: '52%', top: '46%', cell: 7 },
			{ tier: 3, variant: 2, left: '22%', top: '68%', cell: 7 }
		],
		low: [
			{ tier: 4, variant: 0, left: '14%', top: '18%', cell: 8 },
			{ tier: 3, variant: 1, left: '2%', top: '56%', cell: 7 },
			{ tier: 2, variant: 2, left: '60%', top: '58%', cell: 8 }
		]
	};

	type Px = { x: number; y: number; shade: boolean };

	// Same cell classification as drawMark: fill the pattern, then shade the
	// bottom-most cell of each cumulus column so the puff sits on a base.
	function markPixels(band: Band, tier: number, variant: number) {
		const pat = makePattern(band, tier, variant);
		const rows = pat.length;
		const cols = Math.max(...pat.map((r) => r.length));
		const shadeBase = band === 'low' && rows >= 3;
		const px: Px[] = [];
		for (let x = 0; x < cols; x++) {
			let bottom = -1;
			for (let y = 0; y < rows; y++) if (pat[y][x]) bottom = y;
			for (let y = 0; y < rows; y++) {
				if (pat[y][x]) px.push({ x, y, shade: shadeBase && y === bottom });
			}
		}
		return { px, cols, rows, alpha: MARK_ALPHA[band] * TIER_ALPHA[tier - 1] };
	}

	// Each tier's headline cloud and altitude, shown in the tag.
	const LABEL: Record<Band, { name: string; alt: string }> = {
		high: { name: 'Cirrus', alt: 'High · 7 km +' },
		middle: { name: 'Altocumulus', alt: 'Medium · 2–7 km' },
		low: { name: 'Cumulus', alt: 'Low · 0–2 km' }
	};

	// The map's banded day sky as stepped gradient stops (SKY_BANDS = 5).
	const skyStops = Array.from(
		{ length: 5 },
		(_, i) =>
			`color-mix(in srgb, ${SKY.day.top} ${100 - i * 25}%, ${SKY.day.bottom}) ${i * 20}% ${(i + 1) * 20}%`
	);
	const skyStyle = `background: linear-gradient(to bottom, ${skyStops.join(', ')})`;
</script>

{#snippet cloud(band: Band, tier: number, variant: number, left: string, top: string, cell: number)}
	{@const m = markPixels(band, tier, variant)}
	<svg
		class="cloud [shape-rendering:crispEdges]"
		style="left: {left}; top: {top}"
		viewBox="0 0 {m.cols} {m.rows}"
		width={m.cols * cell}
		height={m.rows * cell}
		opacity={m.alpha}
		aria-hidden="true"
	>
		{#each m.px as p (`${p.x},${p.y}`)}
			<rect
				x={p.x}
				y={p.y}
				width="1"
				height="1"
				fill={p.shade ? CLOUD.low.shadow : CLOUD[band].fill}
			/>
		{/each}
	</svg>
{/snippet}

<figure
	class="tiers"
	style={skyStyle}
	aria-label="The three cloud tiers of the meteogram: high cirrus above 7 km, medium clouds between 2 and 7 km, and low cumulus below 2 km."
>
	{#each Object.keys(SCENE) as Band[] as band (band)}
		<div class="band {band}">
			<span class="tag">
				<span class="name">{LABEL[band].name}</span>
				<span class="alt">{LABEL[band].alt}</span>
			</span>
			{#each SCENE[band] as c, i (i)}
				{@render cloud(band, c.tier, c.variant, c.left, c.top, c.cell)}
			{/each}
		</div>
	{/each}
	<div class="ground" aria-hidden="true"></div>
</figure>

<style>
	.tiers {
		float: right;
		width: 208px;
		height: 400px;
		display: flex;
		flex-direction: column;
		margin: 0.25rem 0 calc(0.5 * var(--leading)) 1.25rem;
		/* Hug the right edge of the prose measure, not the wide article box. */
		margin-right: max(0px, calc((100% - var(--measure)) / 2));
		border: 1px solid var(--navy);
	}
	@media (max-width: 40em) {
		.tiers {
			float: none;
			width: 100%;
			margin: 0 0 var(--leading);
		}
	}

	.band {
		position: relative;
		flex: 1;
	}
	.band.low {
		flex: 1.2;
	}
	.band + .band {
		border-top: 1px dashed rgba(255, 255, 255, 0.55);
	}

	.tag {
		position: absolute;
		top: 6px;
		right: 6px;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.1em;
		line-height: 1.3;
		color: #fff;
		white-space: nowrap;
		text-align: right;
		/* The day sky is pale up high, so the white type sits on an ink chip to
		   stay legible against every band. */
		padding: 3px 6px;
		background: rgba(11, 29, 58, 0.72);
	}
	/* Same modular scale as the article type (typography.css): the cloud name a
	   step above the altitude, both on the uppercase caption voice of h5. */
	.tag .name {
		font-size: calc(var(--ms-1) * 1rem);
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.tag .alt {
		font-size: calc(var(--ms--1) * 1rem);
		font-weight: 400;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		opacity: 0.9;
	}

	.cloud {
		position: absolute;
	}

	.ground {
		height: 10px;
		background: var(--navy);
	}
</style>
