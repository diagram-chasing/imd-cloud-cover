// The on-map story title: a PIXI overlay whose placement is scored against a
// land summed-area table so the block settles over open water, at the largest
// comfortable size.
import { Container, Graphics, Rectangle, Sprite, Text, type Texture } from 'pixi.js';
import type { Geo } from './geo';

const STORY_TITLE = "MAPPING INDIA'S CLOUDS";
const STORY_SUB = "A daily map of where it's cloudy";

export type LandFrac = (x0: number, y0: number, x1: number, y1: number) => number;

/** Fraction-of-rect-is-land lookup over land+shallow cells, backed by a
 *  summed-area table built once per geo. */
export function buildLandFrac(geo: Geo): LandFrac {
	const { cols, rows, land, shallow, groundScale: gc } = geo;
	const W = cols + 1;
	const sat = new Uint32Array(W * (rows + 1));
	for (let y = 0; y < rows; y++) {
		for (let x = 0; x < cols; x++) {
			const v = land[y * cols + x] || shallow[y * cols + x] ? 1 : 0;
			sat[(y + 1) * W + (x + 1)] = v + sat[y * W + (x + 1)] + sat[(y + 1) * W + x] - sat[y * W + x];
		}
	}
	return (x0, y0, x1, y1) => {
		const fx0 = Math.floor(x0 / gc);
		const fy0 = Math.floor(y0 / gc);
		const fx1 = Math.ceil(x1 / gc);
		const fy1 = Math.ceil(y1 / gc);
		const fullArea = Math.max(1, (fx1 - fx0) * (fy1 - fy0));
		const cx0 = Math.min(cols, Math.max(0, fx0));
		const cy0 = Math.min(rows, Math.max(0, fy0));
		const cx1 = Math.min(cols, Math.max(0, fx1));
		const cy1 = Math.min(rows, Math.max(0, fy1));
		if (cx1 <= cx0 || cy1 <= cy0) return 0;
		const sum =
			sat[cy1 * W + cx1] - sat[cy0 * W + cx1] - sat[cy1 * W + cx0] + sat[cy0 * W + cx0];
		return sum / fullArea;
	};
}

interface ViewRect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface TitleLayoutCtx {
	vw: number;
	vh: number;
	/** Narrow (portrait-ish) layout — bumps the meta font a step. */
	narrow: boolean;
	/** The live camera view, so placement scores exactly what's on screen. */
	view: ViewRect;
	landFrac: LandFrac;
	metaText: string;
}

// Search the framed view for the title placement that hides the least land, keeping the
// block at a comfortable size (largest size whose best slot is mostly open; else least-bad).
function bestPlacement(
	groupW: number,
	groupH: number,
	{ vw, vh, view, landFrac }: TitleLayoutCtx
) {
	const mx = view.w * 0.03;
	const my = view.h * 0.03;
	// leave the top-right chrome and the bottom dock/legend band clear
	const topAvoid = view.h * 0.05;
	const bottomAvoid = view.h * 0.16;
	const ax0 = view.x + mx;
	const ay0 = view.y + my + topAvoid;
	const ax1 = view.x + view.w - mx;
	const ay1 = view.y + view.h - my - bottomAvoid;
	const availW = ax1 - ax0;
	const availH = ay1 - ay0;

	// Portrait phones: India fills the frame, so the only cover<=OPEN slots are tiny ocean
	// slivers that force a small title. Bias bigger and tolerate more land there — a legible
	// title that overlaps some land beats a shrunken one wedged into a corner.
	const portrait = vh > vw;

	// title's on-screen width is vw * frac (zoom-independent), so cap by an absolute px
	// ceiling: big fractions still work on phones, but desktop stops growing unboundedly
	const MAX_TITLE_PX = portrait ? 520 : 460;
	const maxFrac = MAX_TITLE_PX / vw;
	const SIZE_FRACS = (portrait ? [0.6, 0.56, 0.48, 0.4] : [0.5, 0.42, 0.34, 0.27, 0.2]).map((f) =>
		Math.min(f, maxFrac)
	);
	const GRID_X = 11;
	const GRID_Y = 8;
	const OPEN = portrait ? 0.4 : 0.05;

	let fallback: { x: number; y: number; s: number; cover: number } | null = null;
	let prevF = -1;
	for (const f of SIZE_FRACS) {
		if (f === prevF) continue; // capping can collapse the top fractions together
		prevF = f;
		let s = (view.w * f) / groupW;
		s = Math.min(s, availH / groupH);
		const bw = groupW * s;
		const bh = groupH * s;
		if (bw > availW || bh > availH || s <= 0) continue;
		const spanX = availW - bw;
		const spanY = availH - bh;
		let best: { x: number; y: number; s: number; cover: number; score: number } | null = null;
		for (let iy = 0; iy < GRID_Y; iy++) {
			const py = GRID_Y > 1 ? iy / (GRID_Y - 1) : 0.5;
			const y = ay0 + spanY * py;
			for (let ix = 0; ix < GRID_X; ix++) {
				const px = GRID_X > 1 ? ix / (GRID_X - 1) : 0.5;
				const x = ax0 + spanX * px;
				const cover = landFrac(x, y, x + bw, y + bh);
				// tie-breaker only (dwarfed by cover): prefer the centre of the open area, so
				// with room to spare the title centres rather than jamming into a corner
				const centerDist = Math.max(Math.abs(px - 0.5), Math.abs(py - 0.5)) * 2;
				const score = cover + centerDist * 0.006;
				if (!best || score < best.score) best = { x, y, s, cover, score };
			}
		}
		if (best) {
			if (!fallback || best.cover < fallback.cover) fallback = best;
			if (best.cover <= OPEN) return best;
		}
	}
	return fallback ?? { x: view.x + view.w - groupW * 0.3, y: view.y + view.h * 0.1, s: 0.3 };
}

export class TitleOverlay {
	private group: Container;
	private box: Graphics;
	private text: Text;
	private sub: Text;
	private meta: Text;
	private brand: Text;
	private brandGroup: Container;
	private balloon: Sprite | null = null;
	private balloonBaseY = 0;
	private cx = 0;
	private metaY = 0;
	private laidOut = false;

	constructor(parent: Container) {
		const titleFont = {
			fontFamily: "'Ships Whistle', monospace",
			fill: 0xffffff,
			align: 'left' as const
		};
		this.group = new Container();
		this.group.eventMode = 'passive';
		this.box = new Graphics();
		this.text = new Text({ text: STORY_TITLE, style: { ...titleFont, fontWeight: '700' } });
		this.sub = new Text({ text: STORY_SUB, style: { ...titleFont, fontWeight: '400' } });
		this.meta = new Text({ text: '', style: { ...titleFont, fontWeight: '700' } });

		this.brand = new Text({
			text: 'DIAGRAM CHASING',
			style: { ...titleFont, fontWeight: '700' }
		});
		this.brand.anchor.set(0, 0.5);
		this.brandGroup = new Container();
		this.brandGroup.eventMode = 'static';
		this.brandGroup.cursor = 'pointer';
		this.brandGroup.on('pointertap', () =>
			window.open('https://diagramchasing.fun', '_blank', 'noopener')
		);
		this.brandGroup.addChild(this.brand);
		this.group.addChild(this.box, this.text, this.sub, this.meta, this.brandGroup);
		parent.addChild(this.group);
	}

	/** Nudge sizes so the next layout() counts as a change and re-measures with the
	 *  now-loaded font (PIXI equality-guards style setters). */
	invalidateFonts() {
		for (const t of [this.text, this.sub, this.meta, this.brand]) t.style.fontSize = 0;
	}

	/** Seat the pixel balloon beside the brand text (texture built lazily elsewhere). */
	setBalloon(tex: Texture) {
		if (this.balloon) return;
		this.balloon = new Sprite(tex);
		this.balloon.anchor.set(0.5, 0.5);
		this.balloon.tint = 0xffffff;
		this.brandGroup.addChild(this.balloon);
	}

	layout(ctx: TitleLayoutCtx) {
		const unit = 30;
		const pad = unit * 0.52;
		const gap = unit * 0.5;

		this.text.style.fontSize = unit;
		this.text.style.fontWeight = '700';
		this.text.style.letterSpacing = unit * 0.02;
		this.sub.style.fontSize = unit * 0.7;
		this.meta.style.fontSize = ctx.narrow ? unit * 0.66 : unit * 0.6;
		this.meta.style.letterSpacing = unit * 0.03;
		for (const t of [this.text, this.sub, this.meta]) t.style.fill = 0xffffff;
		this.brand.style.fontSize = unit * 0.6;
		this.brand.style.letterSpacing = unit * 0.08;
		this.brand.style.fill = 0xffffff;

		const innerW = Math.max(this.text.width, this.sub.width);
		const boxW = innerW + pad * 2;
		const rowGap = unit * 0.45;
		const brandW = this.brand.width;
		const brandH = this.brand.height;
		let balloonW = 0;
		let balloonH = 0;
		if (this.balloon) {
			const tex = this.balloon.texture;
			balloonH = brandH * 1.3;
			balloonW = balloonH * (tex.width / tex.height);
		}
		const brandRowH = Math.max(brandH, balloonH);
		const brandGap = gap * 1.2;
		const rowW = brandW + (this.balloon ? rowGap + balloonW : 0);

		let by = brandRowH + brandGap;
		const boxTop = by;
		by += pad;
		const titleY = by;
		by += this.text.height + gap;
		const subY = by;
		by += this.sub.height;
		const boxBottom = by + pad;
		const boxH = boxBottom - boxTop;

		const groupW = Math.max(boxW, this.meta.width, rowW);
		const gcx = groupW / 2;
		const boxX = gcx - boxW / 2;

		const brandCY = brandRowH / 2;
		const rowX0 = gcx - rowW / 2;
		this.brand.position.set(rowX0, brandCY);
		if (this.balloon) {
			this.balloon.scale.set(balloonH / this.balloon.texture.height);
			this.balloon.position.set(rowX0 + brandW + rowGap + balloonW / 2, brandCY);
			this.balloonBaseY = brandCY;
		}
		this.brandGroup.hitArea = new Rectangle(rowX0, 0, rowW, brandRowH);

		this.text.position.set(gcx - this.text.width / 2, titleY);
		this.sub.position.set(gcx - this.sub.width / 2, subY);
		this.cx = gcx;
		this.metaY = boxBottom + gap * 1.5;
		const groupH = this.metaY + this.meta.height;

		this.box.clear();
		this.box
			.rect(boxX, boxTop, boxW, boxH)
			.stroke({ width: Math.max(1, unit * 0.045), color: 0xffffff, alignment: 0 });

		this.laidOut = true;

		const place = bestPlacement(groupW, groupH, ctx);
		this.group.scale.set(place.s);
		this.group.position.set(place.x, place.y);
		this.setMeta(ctx.metaText);
	}

	setMeta(text: string) {
		this.meta.text = text;
		this.meta.position.set(this.cx - this.meta.width / 2, this.metaY);
	}

	/** Fade on zoom-in AND zoom-out: anchored in world coords, drifts up if not faded. */
	fade(zoomRatio: number, night: boolean) {
		if (!this.laidOut) {
			this.group.visible = false;
			return;
		}
		const fadeIn = (1.55 - zoomRatio) / (1.55 - 1.05);
		const fadeOut = (zoomRatio - 0.8) / (1 - 0.8);
		const fade = Math.max(0, Math.min(1, fadeIn, fadeOut));
		this.group.alpha = (night ? 0.72 : 0.6) * fade;
		this.group.visible = fade > 0.01;
	}

	/** Gentle bob of the brand-row balloon (skipped under reduced motion). */
	float(now: number) {
		if (this.balloon) this.balloon.y = this.balloonBaseY + Math.sin(now / 650) * 2;
	}
}
