// Shared "which city is in focus" state for the sky-twin views. The explorer (its
// city search + histogram) and the intro barcode both read and drive it, so
// picking a city in one place updates the other. The last deliberate pick is
// persisted so the choice survives a reload.
const STORE_KEY = 'csx:city';

class CitySkyState {
	/** Focused city's station code, or null until a default resolves. */
	code = $state<string | null>(null);
	/** True once a deliberate pick (search, click, or shuffle — or a restored
	 *  choice) pins the selection, blocking the geo/populous default from
	 *  overriding it. A tentative default stays unpinned so a better one can win. */
	pinned = $state(false);

	/** Deliberate pick: focus + pin + persist. */
	pick(code: string) {
		this.code = code;
		this.pinned = true;
		try {
			localStorage.setItem(STORE_KEY, code);
		} catch {
			/* private mode / storage disabled — ignore */
		}
	}

	/** Tentative default (nearest / most-populous): focus without pinning. */
	suggest(code: string) {
		if (!this.pinned) this.code = code;
	}

	/** The last persisted pick, if any (caller validates it's still a real city). */
	stored(): string | null {
		try {
			return localStorage.getItem(STORE_KEY);
		} catch {
			return null;
		}
	}
}

export const citySky = new CitySkyState();
