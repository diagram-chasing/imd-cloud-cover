<script lang="ts">
	import type { StationsManifest } from '$lib/types';

	interface Props {
		manifest: StationsManifest;
		onselect?: (code: string) => void;
	}
	let { manifest, onselect }: Props = $props();

	let query = $state('');

	// name -> code lookup for resolving the datalist selection.
	let byName = $derived.by(() => {
		const map = new Map<string, string>();
		for (const [code, s] of Object.entries(manifest.stations)) {
			map.set(`${s.name} (${code})`, code);
		}
		return map;
	});

	function submit() {
		const code = byName.get(query) ?? query.toUpperCase();
		if (manifest.stations[code]) {
			onselect?.(code);
			query = '';
		}
	}
</script>

<form
	class="search"
	onsubmit={(e) => {
		e.preventDefault();
		submit();
	}}
>
	<label for="station-search">FIND A STATION</label>
	<input
		id="station-search"
		list="station-list"
		bind:value={query}
		placeholder="e.g. Bengaluru (BNG)"
		autocomplete="off"
	/>
	<datalist id="station-list">
		{#each byName.keys() as name (name)}
			<option value={name}></option>
		{/each}
	</datalist>
	<button type="submit">GO</button>
</form>

<style>
	.search {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	label {
		font-family: var(--font-display);
		font-size: 10px;
		letter-spacing: 0.05em;
	}
	input {
		font-family: var(--font-body);
		font-size: 14px;
		padding: 6px 8px;
		background: var(--paper);
		color: var(--ink);
		box-shadow: 0 0 0 2px var(--ink);
		min-width: 200px;
	}
	button {
		font-family: var(--font-display);
		font-size: 11px;
		padding: 6px 10px;
		background: var(--ink);
		color: var(--ink-on-dark);
		cursor: pointer;
	}
	input:focus-visible,
	button:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
</style>
