
class CitySkyState {
	code = $state<string | null>(null);
	pinned = $state(false);

	pick(code: string) {
		this.code = code;
		this.pinned = true;
	}

	suggest(code: string) {
		if (!this.pinned) this.code = code;
	}

	clear() {
		this.code = null;
		this.pinned = true;
	}
}

export const citySky = new CitySkyState();
