// mirrors PixelMap.svelte constants so the loading shell overlays pixel-for-pixel. keep in sync

export const WORLD_W = 1024;
export const WORLD_H = WORLD_W * 1.06; // buildGeo: worldH = worldW * 1.06
export const PAD = 4;

export interface StartFrame {
	zoom: number;
	panX: number;
	panY: number;
}

/** Screen = (world - pan) * zoom */
export function startFrame(vw: number, vh: number): StartFrame {
	const minX = -PAD;
	const maxX = WORLD_W + PAD;
	const minY = -PAD;
	const maxY = WORLD_H + PAD;
	const bw = maxX - minX;
	const bh = maxY - minY;
	const contain = Math.min(vw / bw, vh / bh);
	const narrow = (vw / contain - bw) / 2 < 90;
	const factor = narrow ? 1.7 : 1.25;
	const zoom = contain * factor;
	const w = vw / zoom;
	const h = vh / zoom;
	let panX = (minX + maxX) / 2 - w / 2;
	const panY = (minY + maxY) / 2 - h / 2;
	// Desktop: shove India right, leaving the left gutter the title sits in.
	if (!narrow) panX = maxX + (vw / contain - bw) / 2 - w;
	return { zoom, panX, panY };
}
