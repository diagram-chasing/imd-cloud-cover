// The map's world frame and camera: contain/fit math, pointer zoom, pan
// clamping, and the fly-to tween. Pure state — components apply it to the PIXI
// stage (or CSS, see MapShell) after each change.

export const WORLD_W = 1024;
export const WORLD_H = WORLD_W * 1.06; // buildGeo: worldH = worldW * 1.06
export const PAD = 4;

export interface CamState {
	zoom: number;
	panX: number;
	panY: number;
}

// world-px gutter below which the layout counts as narrow (portrait phones)
const NARROW_GUTTER = 90;
const PAN_SLACK = 100;

const easeInOutCubic = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

export class MapCamera {
	zoom = 1;
	panX = 0;
	panY = 0;
	vw = 1;
	vh = 1;
	private minX: number;
	private maxX: number;
	private minY: number;
	private maxY: number;
	private tween: { from: CamState; to: CamState; t: number; dur: number } | null = null;

	constructor(worldW = WORLD_W, worldH = WORLD_H, pad = PAD) {
		this.minX = -pad;
		this.maxX = worldW + pad;
		this.minY = -pad;
		this.maxY = worldH + pad;
	}

	setViewport(vw: number, vh: number) {
		this.vw = vw;
		this.vh = vh;
	}

	containZoom(): number {
		return Math.min(this.vw / (this.maxX - this.minX), this.vh / (this.maxY - this.minY));
	}

	/** World-px gutter left beside the contained world at contain zoom. */
	gutterWorld(): number {
		return (this.vw / this.containZoom() - (this.maxX - this.minX)) / 2;
	}

	/** Screen-px gutter beside the contained world (for layout callbacks). */
	screenGutter(): number {
		return (this.vw - (this.maxX - this.minX) * this.containZoom()) / 2;
	}

	narrowLayout(): boolean {
		return this.gutterWorld() < NARROW_GUTTER;
	}

	/** The initial zoom: contain zoom pushed in by the start factor. */
	startZoom(): number {
		return this.containZoom() * (this.narrowLayout() ? 1.7 : 1.25);
	}

	/** Current zoom relative to the start zoom (drives zoom-dependent fades/LOD gates). */
	zoomRatio(): number {
		return this.zoom / this.startZoom();
	}

	/** The world rect currently in view. */
	view() {
		return { x: this.panX, y: this.panY, w: this.vw / this.zoom, h: this.vh / this.zoom };
	}

	/** Reset to the framed start view; wide layouts shift the map into the right gutter. */
	fit() {
		this.zoom = this.startZoom();
		const w = this.vw / this.zoom;
		const h = this.vh / this.zoom;
		this.panX = (this.minX + this.maxX) / 2 - w / 2;
		this.panY = (this.minY + this.maxY) / 2 - h / 2;
		// Desktop: shove the world right, leaving the left gutter the title sits in.
		if (!this.narrowLayout()) this.panX = this.maxX + this.gutterWorld() - w;
	}

	/** Canvas-relative screen px → world px. */
	toWorld(sx: number, sy: number) {
		return { ox: this.panX + sx / this.zoom, oy: this.panY + sy / this.zoom };
	}

	/** World px → canvas-relative screen px. */
	toScreen(wx: number, wy: number) {
		return { x: (wx - this.panX) * this.zoom, y: (wy - this.panY) * this.zoom };
	}

	/** Shift the view by a screen-px delta without clamping (mid-gesture; pair
	 *  with zoomAt or clampPan before applying). */
	move(dxScreen: number, dyScreen: number) {
		this.panX -= dxScreen / this.zoom;
		this.panY -= dyScreen / this.zoom;
	}

	/** Drag: shift by a screen-px delta and clamp. */
	panBy(dxScreen: number, dyScreen: number) {
		this.move(dxScreen, dyScreen);
		this.clampPan();
	}

	zoomBounds() {
		const fit = this.containZoom();
		const narrow = this.narrowLayout();
		// narrow: floor at contain size (fit * 0.4 zoomed into empty gutters)
		return { min: fit * (narrow ? 1 : 0.9), max: fit * (narrow ? 10 : 7) };
	}

	/** Zoom by `factor` about a canvas-relative screen point, clamped. */
	zoomAt(sx: number, sy: number, factor: number) {
		this.tween = null;
		const { ox, oy } = this.toWorld(sx, sy);
		const { min, max } = this.zoomBounds();
		this.zoom = Math.max(min, Math.min(max, this.zoom * factor));
		this.panX = ox - sx / this.zoom;
		this.panY = oy - sy / this.zoom;
		this.clampPan();
	}

	// clamp a pan target for a given zoom (pure) so both the live drag and the
	// fly-to helper share one bounds rule
	private clampFor(px: number, py: number, z: number) {
		const ax = (min: number, size: number, viewWorld: number, v: number) => {
			if (viewWorld >= size) {
				const c = min - (viewWorld - size) / 2;
				return Math.min(c + PAN_SLACK, Math.max(c - PAN_SLACK, v));
			}
			return Math.min(min + size - viewWorld + PAN_SLACK, Math.max(min - PAN_SLACK, v));
		};
		return {
			panX: ax(this.minX, this.maxX - this.minX, this.vw / z, px),
			panY: ax(this.minY, this.maxY - this.minY, this.vh / z, py)
		};
	}

	clampPan() {
		const c = this.clampFor(this.panX, this.panY, this.zoom);
		this.panX = c.panX;
		this.panY = c.panY;
	}

	/** Camera state with world point (wx,wy) centred at targetZoom, clamped. */
	toCenter(wx: number, wy: number, targetZoom: number): CamState {
		const { min, max } = this.zoomBounds();
		const z = Math.max(min, Math.min(max, targetZoom));
		const c = this.clampFor(wx - this.vw / 2 / z, wy - this.vh / 2 / z, z);
		return { zoom: z, panX: c.panX, panY: c.panY };
	}

	flyTo(to: CamState, dur: number) {
		this.tween = { from: { zoom: this.zoom, panX: this.panX, panY: this.panY }, to, t: 0, dur };
	}

	jumpTo(to: CamState) {
		this.tween = null;
		this.zoom = to.zoom;
		this.panX = to.panX;
		this.panY = to.panY;
	}

	cancelTween() {
		this.tween = null;
	}

	/** Advance the fly-to tween; returns true while it is animating. */
	tick(deltaMS: number): boolean {
		if (!this.tween) return false;
		this.tween.t += deltaMS;
		const k = Math.min(1, this.tween.t / this.tween.dur);
		const e = easeInOutCubic(k);
		const { from, to } = this.tween;
		// zoom in log space so the fly-to feels even across the scale change
		this.zoom = from.zoom * Math.pow(to.zoom / from.zoom, e);
		this.panX = from.panX + (to.panX - from.panX) * e;
		this.panY = from.panY + (to.panY - from.panY) * e;
		if (k >= 1) this.tween = null;
		return true;
	}
}

export interface StartFrame {
	zoom: number;
	panX: number;
	panY: number;
}

/** The camera's start frame for a viewport — the loading shell (MapShell) uses
 *  this so its CSS overlay lands pixel-for-pixel on the PIXI start view. */
export function startFrame(vw: number, vh: number): StartFrame {
	const cam = new MapCamera();
	cam.setViewport(vw, vh);
	cam.fit();
	return { zoom: cam.zoom, panX: cam.panX, panY: cam.panY };
}
