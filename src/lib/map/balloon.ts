// The wandering hot-air balloon easter egg: noise-driven drift inside the land
// bbox, a curiosity pull toward the cursor, and a pixel speech bubble of cloud
// puns when poked.
import { Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import { fnv1a, mulberry32 } from './hash';
import { makeCanvas, mkTex } from './textures';

export interface BalloonBounds {
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
}

const BALLOON_W = 15;
const BALLOON_HALF = [2, 3, 4, 5, 6, 7, 7, 7, 7, 6, 6, 5, 5, 4, 4, 3, 3, 2, 1];
const BALLOON_SEAMS = [4, 7, 10];
const BALLOON_SCALE = 0.58;
// world px per ms of drift (tuned against the 1024-px world)
const SPEED = 1024 / 520000;
const BUBBLE_MS = 3800;

// a fresh cloud-name pun every time the balloon is poked
const JOKES = [
	'KEEPING UP WITH \nTHE STRATUS QUO',
	"IT'S ALL\nCIRRUS BUSINESS",
	'WHY SO CIRRUS',
	'DRIZZLE\nME THIS',
	'THATS\nTHUNDER-STANDABLE',
	'DOING MY\nDEW DILIGENCE',
	'SHOWER\nTHOUGHTS',
	'HAIL\nYEAH',
	'SLEET\nDREAMS',
	"STRATUS:\nIT'S COMPLICATED",
	'MIST YOU\nYESTERDAY',
	'ARE YOU CIRRUS\nRIGHT NOW',
	'CHASING SOME\nDIAGRAMS'
];

function buildBalloonTex(): Texture {
	const cx = 7;
	const envH = BALLOON_HALF.length;
	const c = makeCanvas(BALLOON_W, envH + 6);
	const ctx = c.getContext('2d')!;
	ctx.imageSmoothingEnabled = false;
	const W1 = '#ffffff';
	const W2 = '#dde2e8';
	const W3 = '#f0f3f6';
	BALLOON_HALF.forEach((h, y) => {
		const a = cx - h;
		const b = cx + h;
		for (let x = a; x <= b; x++) {
			let col = W1;
			if (x === a || x === b) col = W2;
			else if (BALLOON_SEAMS.includes(x)) col = W2;
			else if (x > cx && ((x + y) & 1) === 0) col = W3;
			ctx.fillStyle = col;
			ctx.fillRect(x, y, 1, 1);
		}
	});
	ctx.fillStyle = W2;
	for (const y of [envH, envH + 1]) {
		ctx.fillRect(cx - 1, y, 1, 1);
		ctx.fillRect(cx + 1, y, 1, 1);
	}
	for (let y = envH + 2; y <= envH + 4; y++) {
		for (let x = cx - 1; x <= cx + 1; x++) {
			ctx.fillStyle = y === envH + 2 ? W1 : W2;
			ctx.fillRect(x, y, 1, 1);
		}
	}
	return mkTex(c);
}

function makeNoise(seed: number): (t: number) => number {
	const rand = mulberry32(seed);
	const grad = Array.from({ length: 256 }, () => rand());
	return (t: number) => {
		const i = Math.floor(t);
		const f = t - i;
		const u = f * f * (3 - 2 * f);
		const a = grad[i & 255];
		const b = grad[(i + 1) & 255];
		return a + (b - a) * u;
	};
}

export class BalloonLayer {
	texture: Texture | null = null;

	/** The camera container — the bubble is (re)appended here so it draws topmost. */
	private parent: Container;
	private layer: Container;
	private sprite: Sprite | null = null;
	private c: Container | null = null;
	private x = 0;
	private y = 0;
	private phase = 0;
	private bounds: BalloonBounds | null = null;
	private noiseX: ((t: number) => number) | null = null;
	private noiseY: ((t: number) => number) | null = null;
	// the balloon nudges toward the last hovered world point, fading back to free
	// wander after the cursor goes still
	private cursor: { x: number; y: number; at: number } | null = null;
	private night = false;

	private bubbleGroup: Container | null = null;
	private bubbleBox: Graphics | null = null;
	private bubbleText: Text | null = null;
	private bubbleShownAt = -1e9;

	/** Reserves the z-order slot; fill() populates after the first frame. */
	constructor(parent: Container) {
		this.parent = parent;
		this.layer = new Container();
		this.layer.eventMode = 'none';
		parent.addChild(this.layer);
	}

	fill(bounds: BalloonBounds) {
		this.texture = buildBalloonTex();
		this.bounds = bounds;
		this.noiseX = makeNoise(fnv1a('balloon-x'));
		this.noiseY = makeNoise(fnv1a('balloon-y'));
		const sp = new Sprite(this.texture);
		sp.anchor.set(0.5, 1);
		sp.scale.set(BALLOON_SCALE);
		this.sprite = sp;
		const c = new Container();
		c.eventMode = 'none';
		c.addChild(sp);
		this.layer.addChild(c);
		this.c = c;
		this.x = bounds.minX + (bounds.maxX - bounds.minX) * 0.4;
		this.y = bounds.minY + (bounds.maxY - bounds.minY) * 0.4;
		c.x = this.x;
		c.y = this.y;
		this.style(this.night);
	}

	hit(ox: number, oy: number): boolean {
		if (!this.c || !this.texture) return false;
		const halfW = (this.texture.width * BALLOON_SCALE) / 2 + 8;
		const h = this.texture.height * BALLOON_SCALE + 8;
		const dx = ox - this.x;
		const dy = oy - this.y; // anchor is the basket (bottom), envelope rises to -h
		return dx >= -halfW && dx <= halfW && dy <= 6 && dy >= -h;
	}

	style(night: boolean) {
		this.night = night;
		if (this.sprite) this.sprite.tint = night ? 0xd2d8de : 0xffffff;
		if (this.bubbleGroup?.visible) this.layoutBubble();
	}

	notifyCursor(x: number, y: number) {
		this.cursor = { x, y, at: performance.now() };
	}

	clearCursor() {
		this.cursor = null;
	}

	private ensureBubble() {
		if (this.bubbleGroup) return;
		this.bubbleGroup = new Container();
		this.bubbleGroup.eventMode = 'none';
		this.bubbleGroup.visible = false;
		this.bubbleBox = new Graphics();
		this.bubbleText = new Text({
			text: JOKES[0],
			style: {
				fontFamily: "'Ships Whistle', monospace",
				fontWeight: '700',
				fontSize: 8,
				fill: 0x0a1a28,
				align: 'center',
				lineHeight: 10,
				letterSpacing: 0.4
			},
			resolution: 4
		});
		this.bubbleText.anchor.set(0.5, 1);
		this.bubbleGroup.addChild(this.bubbleBox, this.bubbleText);
		this.parent.addChild(this.bubbleGroup); // last child → drawn above everything
		this.layoutBubble();
	}

	// bubble lives in world coords but is drawn at a constant screen size (scale
	// 1/zoom, like the place labels), with the tail tip at the group origin
	private layoutBubble() {
		if (!this.bubbleBox || !this.bubbleText) return;
		const padX = 6;
		const padY = 4;
		const tailH = 5;
		const tailW = 6;
		const boxW = this.bubbleText.width + padX * 2;
		const boxH = this.bubbleText.height + padY * 2;
		const bottom = -tailH;
		const top = bottom - boxH;
		const plate = this.night ? 0x0a1a2e : 0xffffff;
		const ink = this.night ? 0xeaf4ff : 0x0a1a28;
		this.bubbleText.style.fill = ink;
		this.bubbleBox.clear();
		this.bubbleBox.rect(-boxW / 2, top, boxW, boxH).fill({ color: plate });
		this.bubbleBox
			.rect(-boxW / 2, top, boxW, boxH)
			.stroke({ width: 1.5, color: ink, alignment: 0 });
		// tail fill covers the box's bottom border where it opens into the tail
		this.bubbleBox.poly([-tailW / 2, bottom, tailW / 2, bottom, 0, 0]).fill({ color: plate });
		this.bubbleBox
			.moveTo(-tailW / 2, bottom)
			.lineTo(0, 0)
			.lineTo(tailW / 2, bottom)
			.stroke({ width: 1.5, color: ink, alignment: 0 });
		this.bubbleText.position.set(0, bottom - padY);
	}

	private positionBubble(zoom: number) {
		if (!this.bubbleGroup || !this.texture) return;
		this.bubbleGroup.position.set(this.x, this.y - this.texture.height * BALLOON_SCALE - 2);
		this.bubbleGroup.scale.set(1 / zoom);
	}

	/** Show a fresh pun bubble (balloon tapped). */
	poke(zoom: number) {
		this.ensureBubble();
		if (!this.bubbleGroup || !this.bubbleText) return;
		this.bubbleText.text = JOKES[Math.floor(Math.random() * JOKES.length)];
		this.layoutBubble();
		this.bubbleShownAt = performance.now();
		this.bubbleGroup.visible = true;
		this.positionBubble(zoom);
	}

	/** Per-frame bubble fade/expiry; cheap no-op while hidden. */
	updateBubble(zoom: number) {
		if (!this.bubbleGroup || !this.bubbleGroup.visible) return;
		const age = performance.now() - this.bubbleShownAt;
		if (age >= BUBBLE_MS) {
			this.bubbleGroup.visible = false;
			return;
		}
		this.bubbleGroup.alpha = Math.max(0, Math.min(1, age / 160, (BUBBLE_MS - age) / 500));
		this.positionBubble(zoom);
	}

	/** Per-frame wander (today view, motion allowed). */
	wander(deltaMS: number) {
		if (!this.c || !this.bounds || !this.noiseX || !this.noiseY) return;
		const b = this.bounds;
		this.phase += deltaMS;

		const F = 0.00006;
		let vx = this.noiseX(this.phase * F) * 2 - 1;
		let vy = this.noiseY(this.phase * F * 1.3) * 2 - 1;
		// curiosity: drift toward the cursor, easing off as it goes still
		let chase = 0;
		if (this.cursor) {
			chase = Math.max(0, 1 - (performance.now() - this.cursor.at) / 4000);
			if (chase > 0) {
				const dx = this.cursor.x - this.x;
				const dy = this.cursor.y - this.y;
				const d = Math.hypot(dx, dy) || 1;
				// slack near the cursor so it hovers around rather than jittering on it
				const pull = chase * 1.7 * Math.min(1, d / 40);
				vx += (dx / d) * pull;
				vy += (dy / d) * pull;
			}
		}
		const margin = 60;
		if (this.x < b.minX + margin) vx += (b.minX + margin - this.x) / margin;
		if (this.x > b.maxX - margin) vx -= (this.x - (b.maxX - margin)) / margin;
		if (this.y < b.minY + margin) vy += (b.minY + margin - this.y) / margin;
		if (this.y > b.maxY - margin) vy -= (this.y - (b.maxY - margin)) / margin;
		const m = Math.hypot(vx, vy) || 1;
		const spd = SPEED * (1 + chase * 1.6);
		this.x += (vx / m) * spd * deltaMS;
		this.y += (vy / m) * spd * deltaMS;
		this.c.x = this.x;
		this.c.y = this.y;
	}
}
