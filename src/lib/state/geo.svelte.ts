// Coarse, IP-based visitor location, fetched once from the Worker's /geo route
// (Cloudflare `request.cf`). Shared across the map (a "you are here" marker) and
// the city explorer (default the nearest city). No permission prompt; city-level.
import { fetchGeo, type GeoHint } from '$lib/api/r2';

class GeoState {
	/** Resolved location, or null while pending / when unavailable. */
	loc = $state<GeoHint | null>(null);
	/** True once the fetch has settled (success or failure) — lets consumers
	 *  distinguish "still detecting" from "no location". */
	resolved = $state(false);
	#started = false;

	/** Fetch the visitor location once; safe to call from multiple components. */
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
