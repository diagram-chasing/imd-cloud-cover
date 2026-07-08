// Tactile feedback for map interaction: short procedural "click" sounds via the
// Web Audio API, plus a light haptic tap on capable devices (web-haptics wraps the
// Vibration API and no-ops on desktop). Sounds are synthesised — no asset files —
// so they work everywhere and stay in sync with the visual change at the callsite.
//
// Haptics are deliberately minimal (select only); the clicks carry the feel.

import { WebHaptics } from 'web-haptics';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let muted = false;

function audio(): { ac: AudioContext; out: GainNode } | null {
	if (typeof window === 'undefined') return null;
	if (!ctx) {
		const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
		if (!AC) return null;
		ctx = new AC();
		master = ctx.createGain();
		master.gain.value = 0.9;
		master.connect(ctx.destination);
	}
	// Browsers start the context suspended until a user gesture; every click is one.
	if (ctx.state === 'suspended') ctx.resume().catch(() => {});
	return { ac: ctx, out: master! };
}

function noiseBuffer(ac: AudioContext): AudioBuffer {
	if (noise) return noise;
	const n = Math.floor(ac.sampleRate * 0.08);
	noise = ac.createBuffer(1, n, ac.sampleRate);
	const d = noise.getChannelData(0);
	for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
	return noise;
}

interface ClickSpec {
	freq: number; // bandpass centre — the tick's pitch
	q: number; // filter sharpness
	decay: number; // seconds
	gain: number; // peak
	tone: number; // tonal-body level (0 = pure noise tick)
}

// A crisp noise transient (the "tick") + a faint tonal body for weight. `select`
// is firmer and lower; `open` is lighter and higher, for chrome appearing.
const PRESETS = {
	select: { freq: 620, q: 1.1, decay: 0.05, gain: 0.28, tone: 0.09 },
	open: { freq: 960, q: 1.6, decay: 0.03, gain: 0.16, tone: 0.05 }
} satisfies Record<string, ClickSpec>;

export type ClickPreset = keyof typeof PRESETS;

export function click(preset: ClickPreset = 'select'): void {
	if (muted) return;
	const a = audio();
	if (!a) return;
	const { ac, out } = a;
	const p = PRESETS[preset];
	const now = ac.currentTime;

	// Noise burst through a bandpass → the click's crisp attack.
	const src = ac.createBufferSource();
	src.buffer = noiseBuffer(ac);
	const bp = ac.createBiquadFilter();
	bp.type = 'bandpass';
	bp.frequency.value = p.freq;
	bp.Q.value = p.q;
	const ng = ac.createGain();
	ng.gain.setValueAtTime(p.gain, now);
	ng.gain.exponentialRampToValueAtTime(0.0001, now + p.decay);
	src.connect(bp).connect(ng).connect(out);
	src.start(now);
	src.stop(now + p.decay + 0.02);

	// A short pitched blip under the noise gives the click a little body, with a
	// downward glide so it reads as a physical tick, not a beep.
	if (p.tone > 0) {
		const osc = ac.createOscillator();
		osc.type = 'triangle';
		osc.frequency.setValueAtTime(p.freq, now);
		osc.frequency.exponentialRampToValueAtTime(p.freq * 0.6, now + p.decay);
		const tg = ac.createGain();
		tg.gain.setValueAtTime(p.tone, now);
		tg.gain.exponentialRampToValueAtTime(0.0001, now + p.decay);
		osc.connect(tg).connect(out);
		osc.start(now);
		osc.stop(now + p.decay + 0.02);
	}
}

let haptics: WebHaptics | null = null;
function device(): WebHaptics | null {
	if (typeof window === 'undefined') return null;
	if (!haptics) haptics = new WebHaptics();
	return haptics;
}

// Light vibration on capable devices; silently no-ops on desktop.
export function tap(pattern: string = 'light'): void {
	if (muted) return;
	device()?.trigger(pattern);
}

export function setMuted(v: boolean): void {
	muted = v;
}
