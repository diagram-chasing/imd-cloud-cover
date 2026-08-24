// Live observations (latest/obs.json), shared by every route that corrects
// the "now" frame (see $lib/obs). Refcounted so the 15-min poll runs once no
// matter how many pages subscribe, survives client-side navigation between
// them, and stops when none remain. Each poll replaces `data` wholesale, so
// $derived chains re-evaluate — that tick is also what keeps nowStepIST()/
// istToday() comparisons fresh in long-lived tabs.
import { fetchObs } from '$lib/api/r2';
import type { ObsLatest } from '$lib/types';

const POLL_MS = 15 * 60 * 1000;

class LiveObsState {
	data = $state<ObsLatest | null>(null);
	#refs = 0;
	#timer: ReturnType<typeof setInterval> | null = null;

	#refresh() {
		// hold the last good copy through a failed poll
		fetchObs().then((o) => (this.data = o ?? this.data));
	}

	/** Subscribe from onMount; returns the matching unsubscribe. */
	use(): () => void {
		if (this.#refs++ === 0) {
			this.#refresh();
			this.#timer = setInterval(() => this.#refresh(), POLL_MS);
		}
		return () => {
			if (--this.#refs === 0 && this.#timer) {
				clearInterval(this.#timer);
				this.#timer = null;
			}
		};
	}
}

export const liveObs = new LiveObsState();
