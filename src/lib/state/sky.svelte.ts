// Shared UI state for the sky map (Svelte 5 runes).
import type { ViewMode } from '$lib/types';
import type { BandKey } from '$lib/theme';

/** Nearest 3-hour step (0-7) to the current time in IST. */
export function defaultTimeIndex(): number {
	const nowUtcMs = Date.now();
	const istMs = nowUtcMs + 5.5 * 3600 * 1000;
	const istHour = new Date(istMs).getUTCHours() + new Date(istMs).getUTCMinutes() / 60;
	return Math.round(istHour / 3) % 8;
}

class SkyState {
	timeIndex = $state(defaultTimeIndex());
	focusBand = $state<BandKey | null>(null); // isolated band; null = all bands
	view = $state<ViewMode>('today');
	windowDayIndex = $state(0); // index into the current rollup window
	selectedCode = $state<string | null>(null);
	hoverCode = $state<string | null>(null);
	playing = $state(false);

	toggleFocus(band: BandKey) {
		this.focusBand = this.focusBand === band ? null : band;
	}

	setView(v: ViewMode) {
		this.view = v;
		this.windowDayIndex = v === 'today' ? this.timeIndex : 0;
	}
}

export const sky = new SkyState();
