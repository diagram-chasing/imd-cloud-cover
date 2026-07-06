// Shared UI state for the sky map (Svelte 5 runes).
import type { ViewMode } from '$lib/types';

/** Nearest 3-hour step (0-7) to the current time in IST. */
export function defaultTimeIndex(): number {
	const nowUtcMs = Date.now();
	const istMs = nowUtcMs + 5.5 * 3600 * 1000;
	const istHour = new Date(istMs).getUTCHours() + new Date(istMs).getUTCMinutes() / 60;
	return Math.round(istHour / 3) % 8;
}

class SkyState {
	timeIndex = $state(defaultTimeIndex());
	bands = $state({ high: true, middle: true, low: true });
	view = $state<ViewMode>('today');
	windowDayIndex = $state(0); // index into the current rollup window
	persistence = $state(false);
	selectedCode = $state<string | null>(null);
	hoverCode = $state<string | null>(null);
	playing = $state(false);

	toggleBand(band: 'high' | 'middle' | 'low') {
		this.bands = { ...this.bands, [band]: !this.bands[band] };
	}

	setView(v: ViewMode) {
		this.view = v;
		this.windowDayIndex = v === 'today' ? this.timeIndex : 0;
	}
}

export const sky = new SkyState();
