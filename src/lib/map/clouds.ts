// The cloud field: pooled sprites for the three cloud bands, their ground
// shadows, and rain streaks, driven by per-bin cover/rain values. Layers are
// attached individually so the caller controls z-order interleaving.
import { Container, Sprite, type Texture } from 'pixi.js';
import {
	SHADOW_ALPHA,
	SHADOW_TINT,
	coverTier,
	rainTier,
	type BandKey,
	type SkyMode
} from '$lib/theme';
import { effectiveCover } from '$lib/format';
import { MARK_VARIANTS, buildMarkAtlas, drawRain } from './sprites';
import { mkTex } from './textures';
import type { Bin } from './lod';

export const MARK_CELL = 3;
export const TOWER_GAP = MARK_CELL * 3.5;
export const BAND_KEYS: BandKey[] = ['low', 'middle', 'high'];

const BAND_OFFSET: Record<BandKey, number> = {
	high: -TOWER_GAP,
	middle: 0,
	low: TOWER_GAP
};
const VAL_KEY: Record<BandKey, 'h' | 'm' | 'l'> = { high: 'h', middle: 'm', low: 'l' };
const SHADOW_DROP = TOWER_GAP + MARK_CELL * 2.5;
// rain streaks hang from the low cloud's bottom edge (sprite anchored top-center)
const RAIN_TOP = TOWER_GAP + MARK_CELL * 1.5;

export type BandCover = (b: Bin, key: 'h' | 'm' | 'l') => number;

export class CloudField {
	private pool: Record<BandKey, Sprite[]> = { low: [], middle: [], high: [] };
	private layers: Record<BandKey, Container> | null = null;
	private shadowLayer: Container | null = null;
	private shadowPool: Sprite[] = [];
	private rainLayer: Container | null = null;
	private rainPool: Sprite[] = [];
	private cloudTex: Record<BandKey, Texture[][]> = { low: [], middle: [], high: [] };
	private rainTex: Texture[][] = []; // [tier 1..3][variant]
	private rainTierByBin: number[] = [];

	attachShadow(parent: Container) {
		this.shadowLayer = new Container();
		this.shadowLayer.eventMode = 'none';
		parent.addChild(this.shadowLayer);
	}

	// rain sits under every cloud band: streaks read as falling FROM the cloud
	attachRain(parent: Container) {
		this.rainLayer = new Container();
		this.rainLayer.eventMode = 'none';
		parent.addChild(this.rainLayer);
	}

	attachBands(parent: Container) {
		const layers = {} as Record<BandKey, Container>;
		for (const band of BAND_KEYS) {
			const layer = new Container();
			parent.addChild(layer);
			layers[band] = layer;
		}
		this.layers = layers;
	}

	buildTextures(cell = MARK_CELL) {
		const atlas = buildMarkAtlas(cell);
		this.cloudTex = { low: [], middle: [], high: [] };
		for (const band of BAND_KEYS) {
			for (let tier = 1; tier <= 4; tier++) {
				this.cloudTex[band][tier] = [];
				for (let v = 0; v < MARK_VARIANTS; v++) {
					this.cloudTex[band][tier][v] = mkTex(atlas.get(band, tier as 1 | 2 | 3 | 4, v).canvas);
				}
			}
		}
		this.rainTex = [];
		for (let tier = 1; tier <= 3; tier++) {
			this.rainTex[tier] = [];
			for (let v = 0; v < MARK_VARIANTS; v++) {
				this.rainTex[tier][v] = mkTex(drawRain(tier as 1 | 2 | 3, v, cell).canvas);
			}
		}
	}

	grow(target: number) {
		if (!this.layers || !this.shadowLayer) return;
		for (let k = this.shadowPool.length; k < target; k++) {
			const s = new Sprite(this.cloudTex.low[1][0]);
			s.anchor.set(0.5, 0.5);
			s.tint = SHADOW_TINT;
			s.visible = false;
			this.shadowLayer.addChild(s);
			this.shadowPool.push(s);
		}
		if (this.rainLayer && this.rainTex.length) {
			for (let k = this.rainPool.length; k < target; k++) {
				const s = new Sprite(this.rainTex[1][0]);
				s.anchor.set(0.5, 0); // top-center: streaks start at the cloud's base
				s.visible = false;
				this.rainLayer.addChild(s);
				this.rainPool.push(s);
			}
		}
		for (const band of BAND_KEYS) {
			const arr = this.pool[band];
			const layer = this.layers[band];
			for (let k = arr.length; k < target; k++) {
				const s = new Sprite(this.cloudTex[band][1][0]);
				s.anchor.set(0.5, 0.5);
				s.visible = false;
				layer.addChild(s);
				arr.push(s);
			}
		}
	}

	/** Seat every pooled sprite on its bin for the active LOD (scale sc). */
	place(bins: Bin[], sc: number) {
		if (!this.layers) return;
		for (const band of BAND_KEYS) {
			const off = BAND_OFFSET[band] * sc;
			const arr = this.pool[band];
			for (let k = 0; k < bins.length; k++) {
				const sp = arr[k];
				sp.x = bins[k].px;
				sp.y = bins[k].py + off;
				sp.scale.set(sc);
			}
			for (let k = bins.length; k < arr.length; k++) arr[k].visible = false;
		}

		const shadowOff = SHADOW_DROP * sc;
		for (let k = 0; k < bins.length; k++) {
			const sp = this.shadowPool[k];
			sp.x = bins[k].px + 2 * sc;
			sp.y = bins[k].py + shadowOff;
			sp.scale.set(sc, sc * 0.55);
		}
		for (let k = bins.length; k < this.shadowPool.length; k++) this.shadowPool[k].visible = false;

		const rainOff = RAIN_TOP * sc;
		for (let k = 0; k < bins.length && k < this.rainPool.length; k++) {
			const sp = this.rainPool[k];
			sp.x = bins[k].px;
			sp.y = bins[k].py + rainOff;
			sp.scale.set(sc);
		}
		for (let k = bins.length; k < this.rainPool.length; k++) this.rainPool[k].visible = false;
	}

	/** Retint/retier every visible sprite from the bins' current values. */
	update(bins: Bin[], cover: BandCover, rain: (b: Bin) => number, driftTick: number) {
		if (!this.layers) return;
		for (const band of BAND_KEYS) {
			const key = VAL_KEY[band];
			for (let i = 0; i < bins.length; i++) {
				const sp = this.pool[band][i];
				if (!sp) break;
				const tier = coverTier(cover(bins[i], key));
				if (tier === 0) {
					sp.visible = false;
					continue;
				}
				sp.visible = true;
				sp.texture = this.cloudTex[band][tier][bins[i].variant];
			}
		}
		// shadow driven by effective cover; higher bands contribute less
		for (let i = 0; i < bins.length; i++) {
			const sp = this.shadowPool[i];
			if (!sp) break;
			const eff = effectiveCover({
				h: cover(bins[i], 'h'),
				m: cover(bins[i], 'm'),
				l: cover(bins[i], 'l')
			});
			const tier = coverTier(eff);
			if (tier === 0) {
				sp.visible = false;
				continue;
			}
			sp.visible = true;
			sp.texture = this.cloudTex.low[tier][bins[i].variant];
		}
		// rain streaks under the tower; rollup views carry no r so this stays dark there
		this.rainTierByBin.length = bins.length;
		for (let i = 0; i < bins.length; i++) {
			const sp = this.rainPool[i];
			if (!sp) break;
			const tier = rainTier(rain(bins[i]));
			this.rainTierByBin[i] = tier;
			if (tier === 0) {
				sp.visible = false;
				continue;
			}
			sp.visible = true;
			sp.texture = this.rainTex[tier][(bins[i].variant + driftTick) % MARK_VARIANTS];
			// raining => cloud: mixed bins can average below the cover floor while
			// still averaging visible rain; never let streaks fall from an empty sky
			const lowSp = this.pool.low[i];
			if (lowSp && !lowSp.visible) {
				lowSp.visible = true;
				lowSp.texture = this.cloudTex.low[1][bins[i].variant];
			}
		}
	}

	/** Ease band alphas toward their focus targets (instant under reduced motion). */
	alphaTick(deltaMS: number, target: Record<BandKey, number>, reduced: boolean) {
		if (!this.layers) return;
		for (const band of BAND_KEYS) {
			const layer = this.layers[band];
			const t = target[band];
			if (reduced || Math.abs(layer.alpha - t) < 0.004) layer.alpha = t;
			else layer.alpha += (t - layer.alpha) * Math.min(1, deltaMS / 90);
		}
	}

	/** Advance the shared drift clock: high band slides, rain shimmers. */
	drift(tick: number, bins: Bin[], sc: number) {
		if (this.layers) this.layers.high.x = tick * 2 * sc;
		for (let i = 0; i < bins.length && i < this.rainPool.length; i++) {
			const t = this.rainTierByBin[i];
			if (t) this.rainPool[i].texture = this.rainTex[t][(bins[i].variant + tick) % MARK_VARIANTS];
		}
	}

	setShadowMode(mode: SkyMode) {
		if (this.shadowLayer) this.shadowLayer.alpha = SHADOW_ALPHA[mode];
	}
}
