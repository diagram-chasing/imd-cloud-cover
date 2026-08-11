// "You are here": a pixel square at the viewer's IP location, with a map-kiosk
// "YOU ARE HERE" nameplate that fades in once the camera gets close. Speaks the
// map's own language — Ships Whistle label on a plate (places.ts), place-label
// ink that flips day/night — so it reads as part of the map rather than a GPS
// widget. Constant screen size (1/zoom).
import { Container, Graphics, Text } from 'pixi.js';
import { UI } from '$lib/theme';

/** zoomRatio at which the nameplate fades in (between city and town label tiers). */
const LABEL_ZOOM = 2.5;
// nameplate floats above the square (square top edge is at -4.5)
const PLATE_BASE = -9.5;

const INK_DAY = 0x0a1a28;
const INK_NIGHT = 0xeaf4ff;

export class YouMarker {
	private layer: Container;
	private marker: Container;
	private border: Graphics;
	private label: Container;
	private labelAlpha = 0;
	private labelTarget = 0;

	constructor(parent: Container) {
		this.layer = new Container();
		this.layer.eventMode = 'none';
		this.layer.visible = false;

		this.marker = new Container();

		// ink-bordered accent square with a white pixel core; border drawn white
		// and tinted so day/night restyling is a tint swap
		this.border = new Graphics();
		this.border.rect(-4.5, -4.5, 9, 9).fill({ color: 0xffffff });
		this.border.tint = INK_DAY;
		this.marker.addChild(this.border);

		const core = new Graphics();
		core.rect(-3, -3, 6, 6).fill({ color: UI.accent });
		core.rect(-1, -1, 2, 2).fill({ color: 0xffffff });
		this.marker.addChild(core);

		this.label = new Container();
		this.label.alpha = 0;
		this.label.visible = false;
		this.marker.addChild(this.label);
		this.buildLabel();

		this.layer.addChild(this.marker);
		parent.addChild(this.layer);
	}

	private buildLabel() {
		for (const c of this.label.removeChildren()) c.destroy();
		const text = new Text({
			text: 'YOU ARE HERE',
			style: {
				fontFamily: "'Ships Whistle', monospace",
				fontWeight: '700',
				fontSize: 12,
				fill: 0xffffff,
				letterSpacing: 0.5
			},
			resolution: 4
		});
		text.anchor.set(0.5, 1);
		text.position.set(0, PLATE_BASE);

		const padX = 3.5;
		const padY = 2;
		const plate = new Graphics();
		plate
			.rect(
				-text.width / 2 - padX,
				PLATE_BASE - text.height - padY,
				text.width + padX * 2,
				text.height + padY * 2
			)
			.fill({ color: UI.accent });
		// bubble tail pointing down at the square
		plate.rect(-1, PLATE_BASE + padY, 2, 2).fill({ color: UI.accent });
		this.label.addChild(plate);
		this.label.addChild(text);
	}

	/** Re-measure the nameplate after the web font lands (see refreshFonts in PixelMap). */
	refreshFont() {
		this.buildLabel();
	}

	show(x: number, y: number) {
		this.layer.position.set(x, y);
		this.layer.visible = true;
	}

	hide() {
		this.layer.visible = false;
	}

	/** Keep the marker at constant screen size. */
	rescale(zoom: number) {
		this.marker.scale.set(1 / zoom);
	}

	style(night: boolean) {
		this.border.tint = night ? INK_NIGHT : INK_DAY;
	}

	onCamera(zoomRatio: number) {
		this.labelTarget = zoomRatio >= LABEL_ZOOM ? 1 : 0;
	}

	tick(dtMS: number, reduced: boolean) {
		if (!this.layer.visible) return;
		if (reduced) {
			this.labelAlpha = this.labelTarget;
		} else {
			this.labelAlpha += (this.labelTarget - this.labelAlpha) * Math.min(1, dtMS / 160);
			if (Math.abs(this.labelTarget - this.labelAlpha) < 0.02) this.labelAlpha = this.labelTarget;
		}
		this.label.alpha = this.labelAlpha;
		this.label.visible = this.labelAlpha > 0.02;
	}
}
