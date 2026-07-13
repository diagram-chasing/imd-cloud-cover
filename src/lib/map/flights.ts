
import { Container, Sprite, Texture, Graphics } from 'pixi.js';
import { mulberry32 } from './hash';

const HUBS: Record<string, [number, number]> = {
	DXB: [55.36, 25.25], DOH: [51.61, 25.27], AUH: [54.65, 24.43], KHI: [67.16, 24.91], // west
	DEL: [77.1, 28.56], KTM: [85.36, 27.7], BOM: [72.87, 19.09], HYD: [78.43, 17.24], // north / central
	CCU: [88.45, 22.65], DAC: [90.4, 23.84], MAA: [80.17, 12.99], BLR: [77.71, 13.2],
	CMB: [79.88, 7.18], MLE: [73.53, 4.19], TRV: [76.92, 8.48], // south
	SIN: [103.99, 1.36], KUL: [101.71, 2.75], BKK: [100.75, 13.69], RGN: [96.13, 16.9], // SE Asia
	HKG: [113.91, 22.31], CAN: [113.3, 23.39], PEK: [116.6, 40.08] // east
};


const ROUTES: [string, string][] = [
	['DXB', 'BKK'], ['DXB', 'SIN'], ['DXB', 'CCU'], ['DXB', 'KUL'], ['DXB', 'HKG'],
	['DOH', 'SIN'], ['DOH', 'DAC'], ['DOH', 'BKK'], ['DOH', 'HKG'], ['AUH', 'MAA'],
	['KHI', 'BKK'], ['KHI', 'CCU'], ['KHI', 'RGN'], ['KHI', 'SIN'],
	['DEL', 'CMB'], ['DEL', 'MAA'], ['DEL', 'MLE'], ['DEL', 'SIN'], ['DEL', 'CAN'],
	['KTM', 'MLE'], ['KTM', 'TRV'], ['BOM', 'CCU'], ['BOM', 'DAC'], ['BOM', 'HKG'],
	['CCU', 'MLE'], ['CCU', 'CMB'], ['HYD', 'DXB'], ['BLR', 'PEK'], ['MLE', 'PEK']
];


const PLANE_ROWS: number[][] = [
	[4, 5, 6], // wingtip (top)
	[5, 6, 7], // wing
	[1, 6, 7, 8], // tail nub + wing root
	[1, 2, 4, 5, 6, 7, 8, 9, 10], // tailplane + body
	[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], // fuselage spine → nose
	[1, 2, 4, 5, 6, 7, 8, 9, 10], // tailplane + body
	[1, 6, 7, 8], // tail nub + wing root
	[5, 6, 7], // wing
	[4, 5, 6] // wingtip (bottom)
];
const PLANE_W = 13;

const SPEED_MIN = 1024 / 95000;
const SPEED_MAX = 1024 / 62000;
const TRAIL_STEP = 2; // world px between recorded contrail points
const TRAIL_MAX = 26; // points kept → ~52px of trail
const TRAIL_ALPHA = 0.5;
const AVOID_R = 30; // world px; planes closer than this steer apart
const SEP_FORCE = 0.00028; // lateral accel from a conflict (px/ms²)
const SPRING = 0.00002; // pull back toward the true corridor when clear
const DAMP = 0.9; // per-16ms velocity damping
const LAT_MAX = 22; // clamp on lateral deviation (px)
const FADE = 0.14; // fraction of the crossing spent fading in / out
const START_SEP = 90; // min world-px gap from other planes when (re)seeding

interface Flight {
	body: Sprite;
	trail: Graphics;
	route: number; // index into `usable` (corridor id), -1 while unseeded
	dir: 1 | -1; // travel direction along that corridor
	ox: number; // a point on the corridor line (world)
	oy: number;
	ux: number; // unit direction of travel
	uy: number;
	nx: number; // left-hand normal (for lateral steering)
	ny: number;
	s: number; // current param along the line
	sStart: number; // param where it entered, off-screen
	sTarget: number; // param where it fully exits, off-screen
	speed: number; // px per ms
	lat: number; // current lateral deviation from the corridor
	latV: number; // lateral velocity
	x: number; // last render position (world)
	y: number;
	pts: number[]; // flat [x0,y0,x1,y1,...] contrail history, tail → head
}

export interface FlightEngine {
	tick(deltaMS: number): void;
	style(night: boolean): void;
	destroy(): void;
}

export interface FlightOptions {
	parent: Container;
	project: (lon: number, lat: number) => [number, number] | null;
	worldW: number;
	worldH: number;
	count?: number;
	reduced?: boolean;
	seed?: number; // optional fixed PRNG seed (tests / reproducibility); random if omitted
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
	const c = document.createElement('canvas');
	c.width = w;
	c.height = h;
	return c;
}
function mkTex(canvas: HTMLCanvasElement): Texture {
	const t = Texture.from(canvas);
	t.source.scaleMode = 'nearest';
	return t;
}
function buildPlaneTex(): Texture {
	const c = makeCanvas(PLANE_W, PLANE_ROWS.length);
	const ctx = c.getContext('2d')!;
	ctx.imageSmoothingEnabled = false;
	ctx.fillStyle = '#ffffff';
	PLANE_ROWS.forEach((xs, y) => {
		for (const x of xs) ctx.fillRect(x, y, 1, 1);
	});
	return mkTex(c);
}

function rectClipLine(
	ox: number, oy: number, ux: number, uy: number,
	minX: number, minY: number, maxX: number, maxY: number
): [number, number] | null {
	let sMin = -Infinity;
	let sMax = Infinity;
	for (const [o, u, lo, hi] of [
		[ox, ux, minX, maxX],
		[oy, uy, minY, maxY]
	] as const) {
		if (u === 0) {
			if (o < lo || o > hi) return null;
		} else {
			let a = (lo - o) / u;
			let b = (hi - o) / u;
			if (a > b) [a, b] = [b, a];
			if (a > sMin) sMin = a;
			if (b < sMax) sMax = b;
		}
	}
	return sMin < sMax ? [sMin, sMax] : null;
}

export function createFlights(opts: FlightOptions): FlightEngine {
	const { parent, project, worldW, worldH } = opts;
	const count = opts.count ?? 6;
	// Decorative only — seed from a fresh random value so the traffic differs each load
	// (unlike the station layout, this needs no deterministic reproducibility).
	const rand = mulberry32(opts.seed ?? ((Math.random() * 0x100000000) >>> 0));
	const planeTex = buildPlaneTex();

	// Project each hub once into world px (some land off-map, as intended).
	const hubXY: Record<string, [number, number]> = {};
	for (const [name, ll] of Object.entries(HUBS)) {
		const w = project(ll[0], ll[1]);
		if (w) hubXY[name] = w;
	}
	// Corridors both of whose hubs projected and whose line crosses the padded frame.
	const M = TRAIL_MAX * TRAIL_STEP + PLANE_W * 2;
	const usable = ROUTES.filter(([a, b]) => hubXY[a] && hubXY[b]);

	// Two planes may share a corridor only if separated by at least this along it, and
	// never head-on. A short queue of recently-flown routes keeps picks from repeating.
	const routeGap = worldW * 1.5;
	// Reject a corridor that runs near-parallel and within this of an active one, so no
	// two planes ride close alongside each other (crossing corridors are still fine).
	const minPathSep = worldW * 0.16;
	const recentMax = Math.max(0, Math.min(8, usable.length - count - 2));
	const recent: number[] = [];
	const trailLayer = new Container();
	const bodyLayer = new Container();
	trailLayer.eventMode = 'none';
	bodyLayer.eventMode = 'none';
	parent.addChild(trailLayer, bodyLayer);

	const flights: Flight[] = [];

	function fade(f: Flight): number {
		const span = f.sTarget - f.sStart;
		if (!span) return 0;
		const t = (f.s - f.sStart) / span; // 0 at entry → 1 at exit
		return Math.max(0, Math.min(1, Math.min(t, 1 - t) / FADE));
	}

	// (Re)seed a plane onto a real corridor: it rides the line through two hubs, clipped
	// so both ends sit just off-screen, entering from a random end. `initial` scatters it
	// partway along so the sky is busy on load. A route is rejected if it was flown very
	// recently (keeps picks varied) or if it would put two planes on the same corridor
	// too close together or head-on.
	function seed(f: Flight, initial = false): boolean {
		for (let tries = 0; tries < 40; tries++) {
			const route = Math.floor(rand() * usable.length);
			if (recent.includes(route)) continue; // don't reuse a just-flown corridor
			const [ha, hb] = usable[route];
			const a = hubXY[ha];
			const b = hubXY[hb];
			let dx = b[0] - a[0];
			let dy = b[1] - a[1];
			const len = Math.hypot(dx, dy);
			if (len < 1) continue;
			dx /= len;
			dy /= len;
			const clip = rectClipLine(a[0], a[1], dx, dy, -M, -M, worldW + M, worldH + M);
			if (!clip) continue;
			let [start, end] = clip;
			// Randomise which end we enter from; flip the travel direction to match.
			let dir: 1 | -1 = 1;
			if (rand() < 0.5) {
				[start, end] = [end, start];
				dir = -1;
			}
			const ux = dx * dir;
			const uy = dy * dir;
			const s = initial ? start + (end - start) * (0.15 + rand() * 0.7) : start;
			const ex = a[0] + s * dx;
			const ey = a[1] + s * dy;
			// Separation rules against every other in-flight plane:
			//  • same corridor → must be same direction AND far apart (no tailgating / head-on)
			//  • near-parallel corridor → must not run close alongside (perpendicular gap)
			//  • otherwise (crossing) → entry point must clear the other plane
			let clash = false;
			for (const o of flights) {
				if (o === f || o.route < 0) continue;
				const gap2 = (o.x - ex) ** 2 + (o.y - ey) ** 2;
				if (o.route === route) {
					if (o.dir !== dir || gap2 < routeGap * routeGap) {
						clash = true;
						break;
					}
					continue;
				}
				// |sin(angle between headings)| — small ⇒ the two corridors are parallel.
				const cross = Math.abs(ux * o.uy - uy * o.ux);
				if (cross < 0.35) {
					// Perpendicular distance from this corridor's point to the other's line.
					const perp = Math.abs((a[0] - o.ox) * o.uy - (a[1] - o.oy) * o.ux);
					if (perp < minPathSep) {
						clash = true;
						break;
					}
				} else if (gap2 < START_SEP * START_SEP) {
					clash = true;
					break;
				}
			}
			if (clash) continue;

			recent.push(route);
			if (recent.length > recentMax) recent.shift();
			f.route = route;
			f.dir = dir;
			f.ox = a[0];
			f.oy = a[1];
			f.ux = ux;
			f.uy = uy;
			f.nx = -uy; // left-hand normal
			f.ny = ux;
			f.sStart = s;
			f.sTarget = end;
			f.speed = SPEED_MIN + rand() * (SPEED_MAX - SPEED_MIN);
			f.s = s;
			f.lat = 0;
			f.latV = 0;
			f.x = ex;
			f.y = ey;
			f.pts.length = 0;
			f.trail.clear();
			f.body.rotation = Math.atan2(uy, ux);
			f.body.position.set(ex, ey);
			f.body.alpha = fade(f);
			f.body.visible = true;
			return true;
		}
		return false;
	}

	for (let i = 0; i < count; i++) {
		const trail = new Graphics();
		const body = new Sprite(planeTex);
		body.anchor.set(1, 0.5); // nose at the container origin
		trailLayer.addChild(trail);
		bodyLayer.addChild(body);
		const f: Flight = {
			body, trail, route: -1, dir: 1,
			ox: 0, oy: 0, ux: 1, uy: 0, nx: 0, ny: 1,
			s: 0, sStart: 0, sTarget: 0, speed: 0,
			lat: 0, latV: 0, x: -1e4, y: -1e4, pts: []
		};
		// Reduced motion never ticks; seed off-screen (invisible) rather than mid-flight.
		if (!seed(f, !opts.reduced)) body.visible = false;
		flights.push(f);
	}

	let trailTint = 0xffffff;
	function drawTrail(f: Flight, alpha: number) {
		const g = f.trail;
		g.clear();
		const n = f.pts.length / 2;
		if (n < 2) return;
		// Ramp alpha 0 (tail) → full (head) so the contrail dissipates behind the plane.
		for (let i = 1; i < n; i++) {
			const a = (i / (n - 1)) * TRAIL_ALPHA * alpha;
			if (a <= 0.002) continue;
			g.moveTo(f.pts[(i - 1) * 2], f.pts[(i - 1) * 2 + 1]);
			g.lineTo(f.pts[i * 2], f.pts[i * 2 + 1]);
			g.stroke({ width: 1, color: trailTint, alpha: a });
		}
	}

	function tick(deltaMS: number) {
		const dt = Math.min(deltaMS, 48); // clamp long frames (tab return) so nothing warps
		const damp = Math.pow(DAMP, dt / 16);

		for (const f of flights) {
			f.s += f.speed * dt;
			f.latV += -SPRING * f.lat * dt;
		}

		for (let i = 0; i < flights.length; i++) {
			const a = flights[i];
			if (a.body.alpha <= 0.01) continue;
			for (let j = i + 1; j < flights.length; j++) {
				const b = flights[j];
				if (b.body.alpha <= 0.01) continue;
				const dx = a.x - b.x;
				const dy = a.y - b.y;
				const d2 = dx * dx + dy * dy;
				if (d2 >= AVOID_R * AVOID_R || d2 < 1e-4) continue;
				const push = SEP_FORCE * (1 - Math.sqrt(d2) / AVOID_R) * dt;
				// Each yields to the side it already lies on relative to the other.
				a.latV += Math.sign(dx * a.nx + dy * a.ny || 1) * push;
				b.latV += Math.sign(-dx * b.nx - dy * b.ny || 1) * push;
			}
		}
		// 3) Integrate lateral motion, then render position, heading, contrail, and alpha.
		for (const f of flights) {
			f.lat += f.latV * dt;
			f.latV *= damp;
			if (f.lat > LAT_MAX) { f.lat = LAT_MAX; f.latV = 0; }
			else if (f.lat < -LAT_MAX) { f.lat = -LAT_MAX; f.latV = 0; }

			const px = f.x;
			const py = f.y;
			f.x = f.ox + f.s * f.ux + f.nx * f.lat;
			f.y = f.oy + f.s * f.uy + f.ny * f.lat;
			const a = fade(f);
			f.body.position.set(f.x, f.y);
			f.body.alpha = a;
			// Heading follows the true velocity so lateral steering visibly banks the nose.
			const vx = f.x - px;
			const vy = f.y - py;
			if (vx * vx + vy * vy > 0.02) f.body.rotation = Math.atan2(vy, vx);

			// Record the contrail every TRAIL_STEP px, dropping the oldest past TRAIL_MAX.
			const n = f.pts.length;
			if (n === 0 || (f.x - f.pts[n - 2]) ** 2 + (f.y - f.pts[n - 1]) ** 2 >= TRAIL_STEP ** 2) {
				f.pts.push(f.x, f.y);
				if (f.pts.length > TRAIL_MAX * 2) f.pts.splice(0, 2);
			}
			drawTrail(f, a);

			if (f.s >= f.sTarget) seed(f); // crossed the far (off-screen) end → new corridor
		}
	}

	function style(night: boolean) {
		trailTint = night ? 0xcfe4ff : 0xffffff;
		const bodyTint = night ? 0xdfe9ff : 0xffffff;
		for (const f of flights) f.body.tint = bodyTint;
	}

	function destroy() {
		flights.length = 0;
		trailLayer.destroy({ children: true });
		bodyLayer.destroy({ children: true });
		planeTex.destroy(true);
	}

	return { tick, style, destroy };
}
