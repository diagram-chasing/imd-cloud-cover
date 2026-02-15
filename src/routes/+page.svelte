<script lang="ts">
	import { onMount } from 'svelte';
	import * as d3 from 'd3';

	interface CloudDataPoint {
		datetime: string;
		high: number;
		middle: number;
		low: number;
	}

	interface CloudDataResponse {
		start_date: string;
		samples: number;
		data: CloudDataPoint[];
	}

	interface ParsedDataPoint {
		datetime: Date;
		high: number;
		middle: number;
		low: number;
	}

	interface Bar {
		x: number;
		y: number;
		width: number;
		height: number;
	}

	interface Tick {
		x: number;
		label: string;
	}

	// @ts-expect-error - DOM element binding, not reactive state
	let container: HTMLDivElement | undefined;
	let data = $state<CloudDataPoint[] | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);

	const R2_PUBLIC_URL =
		import.meta.env.VITE_R2_PUBLIC_URL || 'https://pub-b1c53e2bb8fe4ed5a7357663d3707db5.r2.dev';
	const LOCATION = 'BNG';
	const today = new Date().toISOString().split('T')[0];

	const margin = { top: 60, right: 0, bottom: 60, left: 10 };
	let width = $state(0);
	let height = $state(0);
	let parsedData = $state<ParsedDataPoint[]>([]);
	let bars = $state<Bar[]>([]);
	let xTicks = $state<Tick[]>([]);
	let dividerLines = $state<number[]>([]);

	async function fetchCloudData() {
		try {
			const url = `${R2_PUBLIC_URL}/${today}/${LOCATION}-meteogram.json`;
			const response = await fetch(url);

			if (!response.ok) {
				throw new Error(`Failed to fetch data: ${response.statusText}`);
			}

			const jsonData: CloudDataResponse = await response.json();
			data = jsonData.data;
			loading = false;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Unknown error occurred';
			loading = false;
		}
	}

	function calculateChart() {
		if (!data || !container) return;

		width = container.clientWidth - margin.left - margin.right;
		height = container.clientHeight - margin.top - margin.bottom;

		// Parse dates
		const parseTime = d3.timeParse('%Y-%m-%dT%H:%M:%S');
		parsedData = data.map((d) => ({
			datetime: typeof d.datetime === 'string' ? parseTime(d.datetime)! : new Date(d.datetime),
			high: +d.high || 0,
			middle: +d.middle || 0,
			low: +d.low || 0
		}));

		const samples = parsedData.length;
		const stepWidth = width / samples;

		// Calculate divider lines at 33% and 66%
		dividerLines = [33, 66].map((yPercent) => height - (yPercent / 100) * height);

		// Calculate bars for all layers (reduced multipliers for cloud-like appearance)
		const layers = [
			{ key: 'high', baseY: 66, multiplier: 0.06 },
			{ key: 'middle', baseY: 33, multiplier: 0.06 },
			{ key: 'low', baseY: 0, multiplier: 0.06 }
		];

		const tempBars: Bar[] = [];
		layers.forEach((layer) => {
			parsedData.forEach((d, i) => {
				const cloudValue = d[layer.key as keyof ParsedDataPoint] as number;
				const val = cloudValue * layer.multiplier + layer.baseY;

				const yBottom = height - (layer.baseY / 100) * height;
				const yTop = height - (val / 100) * height;

				const xStart = i * stepWidth;
				const barWidth = stepWidth;

				if (yTop < yBottom) {
					tempBars.push({
						x: xStart,
						y: yTop,
						width: barWidth,
						height: yBottom - yTop
					});
				}
			});
		});
		bars = tempBars;

		// Calculate x-axis ticks
		const xScale = d3
			.scaleTime()
			.domain([parsedData[0].datetime, parsedData[parsedData.length - 1].datetime])
			.range([0, width]);

		const timeFormat = d3.timeFormat('%d %b');
		const tickValues = xScale.ticks(8);

		xTicks = tickValues.map((tick) => ({
			x: xScale(tick),
			label: timeFormat(tick)
		}));
	}

	$effect(() => {
		if (data && container) {
			calculateChart();
		}
	});

	onMount(() => {
		fetchCloudData();

		const handleResize = () => {
			if (data && container) {
				calculateChart();
			}
		};

		window.addEventListener('resize', handleResize);
		return () => window.removeEventListener('resize', handleResize);
	});
</script>

<div class="fixed inset-0 bg-gradient-to-b from-[#399DE1] to-[#5FC2F1] overflow-hidden">
	<div class="w-full h-full p-5 box-border" bind:this={container}>
		{#if error}
			<div class="flex items-center justify-center h-full">
				<p class="text-white/60 text-sm">{error}</p>
			</div>
		{:else if width > 0 && height > 0}
			<svg
				width={width + margin.left + margin.right}
				height={height + margin.top + margin.bottom}
			>
				<g transform="translate({margin.left},{margin.top})">
					<!-- Divider lines -->
					{#each dividerLines as yPos}
						<line
							x1={0}
							x2={width}
							y1={yPos}
							y2={yPos}
							stroke="rgba(255, 255, 255, 0.1)"
							stroke-width={1}
						/>
					{/each}

					<!-- Cloud bars -->
					{#each bars as bar}
						<rect
							x={bar.x}
							y={bar.y}
							width={bar.width}
							height={bar.height}
							fill="#ffffff"
							class="transition-opacity duration-300"
							style="opacity: {loading ? 0 : 1}"
						/>
					{/each}

					<!-- X-axis ticks -->
					<g transform="translate(0,{height})">
						{#each xTicks as tick}
							<g transform="translate({tick.x},0)">
								<line y2={6} stroke="#ffffff" />
								<text
									y={20}
									text-anchor="middle"
									fill="#ffffff"
									font-size="12px"
									font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
								>
									{tick.label}
								</text>
							</g>
						{/each}
						<line x1={0} x2={width} stroke="#ffffff" />
					</g>

					<!-- Title -->
					<text
						x={width / 2}
						y={-25}
						text-anchor="middle"
						fill="#ffffff"
						font-size="24px"
						font-weight="300"
						font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
					>
						Cloud Coverage - {LOCATION}
					</text>
				</g>
			</svg>
		{/if}
	</div>
</div>

<style>
	:global(body) {
		margin: 0;
		padding: 0;
	}
</style>
