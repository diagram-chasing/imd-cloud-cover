// Small PIXI texture helpers shared by the map layers (nearest-neighbour pixel look).
import { Texture } from 'pixi.js';

export function mkTex(canvas: HTMLCanvasElement | OffscreenCanvas): Texture {
	const t = Texture.from(canvas as HTMLCanvasElement);
	t.source.scaleMode = 'nearest';
	return t;
}

export function loadTex(url: string): Promise<Texture> {
	return new Promise((res, rej) => {
		const im = new Image();
		im.onload = () => {
			const t = Texture.from(im);
			t.source.scaleMode = 'nearest';
			res(t);
		};
		im.onerror = rej;
		im.src = url;
	});
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
	const c = document.createElement('canvas');
	c.width = w;
	c.height = h;
	return c;
}
