// Ambient two-frame pixel waves scattered over open water in the lower half of
// the frame (denser toward the bottom).
import { Container, Sprite, type Texture } from 'pixi.js';
import { WAVE, type SkyMode } from '$lib/theme';
import { fnv1a, mulberry32 } from './hash';
import { makeCanvas, mkTex } from './textures';
import type { Geo } from './geo';

const WAVE_SCALE = 1.25;
const WAVE_MAX = 100;
const CURVE = [1, 0, 0, 1, 2, 2, 1, 1];

function buildWaveTex(): Texture[] {
	const W = CURVE.length;
	return [0, 1].map((shift) => {
		const c = makeCanvas(W, 3);
		const ctx = c.getContext('2d')!;
		ctx.fillStyle = '#ffffff';
		for (let x = 0; x < W; x++) ctx.fillRect(x, CURVE[(x + shift) % W], 1, 1);
		return mkTex(c);
	});
}

export class WaveLayer {
	private layer: Container;
	private tex: Texture[] = [];
	private waves: { s: Sprite; phase: number }[] = [];

	/** Reserves the z-order slot; fill() builds sprites after the first frame. */
	constructor(parent: Container) {
		this.layer = new Container();
		this.layer.eventMode = 'none';
		parent.addChild(this.layer);
	}

	fill(geo: Geo) {
		this.tex = buildWaveTex();
		this.waves = [];
		const gc = geo.groundScale;
		const r = mulberry32(fnv1a('waves'));

		const marginX = Math.round(geo.cols * 0.7);
		const cand: { x: number; y: number }[] = [];
		for (let y = Math.ceil(geo.rows * 0.5); y < geo.rows; y++) {
			for (let x = -marginX; x < geo.cols + marginX; x++) {
				if (x >= 0 && x < geo.cols) {
					const idx = y * geo.cols + x;
					if (geo.land[idx] || geo.shallow[idx]) continue;
				}
				const p = 0.0022 * (y > geo.rows * 0.62 ? 1.7 : 1);
				if (r() < p) cand.push({ x, y });
			}
		}
		for (let i = cand.length - 1; i > 0; i--) {
			const j = Math.floor(r() * (i + 1));
			[cand[i], cand[j]] = [cand[j], cand[i]];
		}
		for (const { x, y } of cand.slice(0, WAVE_MAX)) {
			const s = new Sprite(this.tex[r() < 0.5 ? 0 : 1]);
			s.anchor.set(0.5, 0.5);
			s.scale.set(WAVE_SCALE);
			s.position.set((x + 0.5) * gc + (r() * 4 - 2), (y + 0.5) * gc + (r() * 4 - 2));
			this.layer.addChild(s);
			this.waves.push({ s, phase: Math.floor(r() * 4) });
		}
	}

	style(mode: SkyMode) {
		const pal = WAVE[mode];
		for (const w of this.waves) {
			w.s.tint = pal.color;
			w.s.alpha = pal.alpha;
		}
	}

	/** Swap frames on the shared drift clock. */
	drift(tick: number) {
		for (const w of this.waves) w.s.texture = this.tex[(tick + w.phase) & 1];
	}
}
