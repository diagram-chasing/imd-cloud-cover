// shared focused-city state for sky-twin views; last deliberate pick is persisted
const STORE_KEY = 'csx:city';

class CitySkyState {
	/** Focused city's station code, or null until a default resolves. */
	code = $state<string | null>(null);
	/** pins selection; blocks geo/populous default from overriding a deliberate pick */
	pinned = $state(false);

	/** focus + pin + persist */
	pick(code: string) {
		this.code = code;
		this.pinned = true;
		try {
			localStorage.setItem(STORE_KEY, code);
		} catch {
			/* private mode / storage disabled — ignore */
		}
	}

	/** tentative default: focus without pinning */
	suggest(code: string) {
		if (!this.pinned) this.code = code;
	}

	/** last persisted pick; caller validates it's still a live station */
	stored(): string | null {
		try {
			return localStorage.getItem(STORE_KEY);
		} catch {
			return null;
		}
	}
}

export const citySky = new CitySkyState();
