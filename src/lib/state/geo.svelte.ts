// IP-based visitor location from /geo; shared by the map marker and city-explorer default
import { fetchGeo, type GeoHint } from '$lib/api/r2';

class GeoState {
	/** Resolved location, or null while pending / when unavailable. */
	loc = $state<GeoHint | null>(null);
	/** true once fetch settles - distinguishes "detecting" from "no location" */
	resolved = $state(false);
	#started = false;

	/** fetch once; safe to call from multiple components */
	ensure() {
		if (this.#started) return;
		this.#started = true;
		fetchGeo()
			.then((g) => {
				this.loc = g;
			})
			.catch(() => {})
			.finally(() => {
				this.resolved = true;
			});
	}
}

export const userGeo = new GeoState();
