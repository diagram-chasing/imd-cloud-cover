// Deterministic star field for night steps. ~1 star per 60 cells; 10% are
// 5-cell plus shapes. Visibility (clear-sky gating) and twinkle are applied at
// draw time; positions are fixed by a seeded PRNG so the field is stable.
import { mulberry32 } from './hash';

export interface Star {
	x: number; // logical px (cell-aligned top-left)
	y: number;
	plus: boolean;
	hidden: boolean; // toggled by the twinkle loop
}

export function generateStars(cols: number, rows: number, cell: number, seed = 42): Star[] {
	const rand = mulberry32(seed);
	const count = Math.floor((cols * rows) / 60);
	const stars: Star[] = [];
	for (let i = 0; i < count; i++) {
		const cx = Math.floor(rand() * cols);
		const cy = Math.floor(rand() * rows);
		const plus = rand() < 0.1;
		stars.push({ x: cx * cell, y: cy * cell, plus, hidden: false });
	}
	return stars;
}
