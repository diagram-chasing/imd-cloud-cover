import { fetchGeo, type GeoHint } from '$lib/api/r2';

class GeoState {
	loc = $state<GeoHint | null>(null);
	resolved = $state(false);
	#started = false;

	ensure() {
		if (this.#started) return;
		this.#started = true;
		fetchGeo()
			.then((g) => {
				this.loc = g;
			})
			.catch(() => { })
			.finally(() => {
				this.resolved = true;
			});
	}
}

export const userGeo = new GeoState();
