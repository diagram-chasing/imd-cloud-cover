import type { ViewMode } from '$lib/types';
import type { BandKey } from '$lib/theme';

export function defaultTimeIndex(): number {
	const nowUtcMs = Date.now();
	const istMs = nowUtcMs + 5.5 * 3600 * 1000;
	const istHour = new Date(istMs).getUTCHours() + new Date(istMs).getUTCMinutes() / 60;
	return Math.round(istHour / 3) % 8;
}

class SkyState {
	timeIndex = $state(defaultTimeIndex());
	focusBand = $state<BandKey | null>(null);
	view = $state<ViewMode>('today');
	windowDayIndex = $state(0); 
	selectedCode = $state<string | null>(null);
	hoverCode = $state<string | null>(null);
	playing = $state(false);
	showStreaks = $state(false)

	toggleFocus(band: BandKey) {
		this.focusBand = this.focusBand === band ? null : band;
	}

	setView(v: ViewMode) {
		this.view = v;
		this.windowDayIndex = v === 'today' ? this.timeIndex : 0;
	}
}

export const sky = new SkyState();
