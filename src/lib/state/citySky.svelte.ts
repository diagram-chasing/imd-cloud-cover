// shared focused-city state for sky-twin views. Deliberately NOT persisted: on a
// fresh load the explorer re-defaults to the visitor's own city (or a fallback),
// rather than restoring whatever they last clicked.
class CitySkyState {
	/** Focused city's station code, or null until a default resolves. */
	code = $state<string | null>(null);
	/** pins selection; blocks geo/populous default from overriding a deliberate pick */
	pinned = $state(false);

	/** focus + pin */
	pick(code: string) {
		this.code = code;
		this.pinned = true;
	}

	/** tentative default: focus without pinning */
	suggest(code: string) {
		if (!this.pinned) this.code = code;
	}

	/** drop the focus so the full front shows unhighlighted; stays pinned so the
	    geo/populous default doesn't immediately re-suggest a city this session */
	clear() {
		this.code = null;
		this.pinned = true;
	}
}

export const citySky = new CitySkyState();
