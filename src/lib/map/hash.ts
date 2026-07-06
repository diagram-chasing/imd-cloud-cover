// Deterministic hashing/PRNG so the map renders identically across loads.
// No Math.random anywhere in the render path.

/** FNV-1a 32-bit hash of a string. */
export function fnv1a(str: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

/** Deterministic ±range integer jitter from a seed string and salt. */
export function jitter(code: string, salt: string, range = 1): number {
	const h = fnv1a(code + salt);
	return (h % (2 * range + 1)) - range;
}

/** mulberry32 PRNG seeded deterministically; returns () => [0,1). */
export function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return function () {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
