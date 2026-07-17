// Place labels (city names) with tier-gated zoom visibility and screen-space
// decluttering. Labels keep constant screen size (scale 1/zoom).
import { Container, Graphics, Text } from 'pixi.js';
import type { GeoPlace } from './geo';

/** zoomRatio at which each tier's labels appear (0 megacity … 3 town). */
export const TIER_ZOOM = [1.6, 3.2, 3.6, Infinity];
const LABEL_SIZE = [19, 16, 13, 11];
const GAP = 5;

export class PlacesLayer {
	private layer: Container;
	private places: GeoPlace[] = [];
	private markers: Container[] = [];
	private labels: Text[] = [];
	private dots: Graphics[] = [];
	private plates: Graphics[] = [];

	constructor(parent: Container) {
		this.layer = new Container();
		this.layer.eventMode = 'none';
		parent.addChild(this.layer);
	}

	get built(): boolean {
		return this.markers.length > 0;
	}

	fill(places: GeoPlace[], night: boolean) {
		this.places = places;
		for (const p of places) {
			const m = new Container();
			m.eventMode = 'none';
			m.position.set(p.px, p.py);

			const dot = new Graphics();
			dot.rect(-1.5, -1.5, 3, 3).fill({ color: 0xffffff });
			m.addChild(dot);
			this.dots.push(dot);

			const label = new Text({
				text: p.name.toUpperCase(),
				style: {
					fontFamily: "'Ships Whistle', monospace",
					fontWeight: '400',
					fontSize: LABEL_SIZE[p.tier] ?? 11,
					fill: 0xffffff,
					letterSpacing: 0.5
				},
				resolution: 4
			});
			label.anchor.set(0, 0.5);
			label.position.set(GAP, 0);

			const padX = 2.5;
			const padY = 1.5;
			const plate = new Graphics();
			plate
				.rect(GAP - padX, -label.height / 2 - padY, label.width + padX * 2, label.height + padY * 2)
				.fill({ color: 0xffffff });
			m.addChild(plate);
			this.plates.push(plate);

			m.addChild(label);
			this.labels.push(label);

			this.layer.addChild(m);
			this.markers.push(m);
		}
		this.style(night);
	}

	style(night: boolean) {
		const ink = night ? 0xeaf4ff : 0x0a1a28;
		const plate = night ? 0x0a1a2e : 0xf7faf6;
		const plateAlpha = night ? 0.66 : 0.82;
		for (const d of this.dots) {
			d.tint = ink;
			d.alpha = 1;
		}
		for (const pl of this.plates) {
			pl.tint = plate;
			pl.alpha = plateAlpha;
		}
		for (const t of this.labels) {
			t.style.fill = ink;
			t.alpha = 1;
		}
	}

	/** Keep labels at constant screen size. */
	rescale(zoom: number) {
		const s = 1 / zoom;
		for (const m of this.markers) m.scale.set(s);
	}

	/** Hide labels below their tier's zoom gate, off screen, or colliding with an
	 *  already-placed label. */
	declutter(cam: {
		zoomRatio: number;
		panX: number;
		panY: number;
		zoom: number;
		vw: number;
		vh: number;
	}) {
		const zr = cam.zoomRatio;
		this.layer.visible = zr >= TIER_ZOOM[0];
		if (!this.layer.visible) return;

		const placed: { l: number; r: number; t: number; b: number; ax: number; ay: number }[] = [];
		const M = 40;
		const TIER_GAP2 = [92 * 92, 92 * 92, 160 * 160, Infinity];
		for (let i = 0; i < this.markers.length; i++) {
			const p = this.places[i];
			const m = this.markers[i];
			if (zr < TIER_ZOOM[p.tier]) {
				m.visible = false;
				continue;
			}
			const sx = (p.px - cam.panX) * cam.zoom;
			const sy = (p.py - cam.panY) * cam.zoom;
			if (sx < -M || sx > cam.vw + M || sy < -M || sy > cam.vh + M) {
				m.visible = false;
				continue;
			}

			const label = this.labels[i];
			const l = sx - 3;
			const r = sx + 5 + label.width + 3;
			const t = sy - label.height / 2 - 2;
			const b = sy + label.height / 2 + 2;
			const gap2 = TIER_GAP2[p.tier];
			let hit = false;
			for (const q of placed) {
				const dx = sx - q.ax;
				const dy = sy - q.ay;
				if (dx * dx + dy * dy < gap2 || (l < q.r && r > q.l && t < q.b && b > q.t)) {
					hit = true;
					break;
				}
			}
			if (hit) {
				m.visible = false;
				continue;
			}
			m.visible = true;
			placed.push({ l, r, t, b, ax: sx, ay: sy });
		}
	}
}
