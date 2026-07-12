
function effectiveCover(v: { h: number; m: number; l: number }): number {
	return Math.max(v.l, v.m * 0.8, v.h * 0.45);
}


export function skyCondition(v: { h: number; m: number; l: number } | null): string {
	if (!v) return '';
	const c = effectiveCover(v);
	if (c < 13) return 'CLEAR';
	if (c < 38) return 'MOSTLY CLEAR';
	if (c < 63) return 'PARTLY CLOUDY';
	if (c < 88) return 'MOSTLY CLOUDY';
	return 'OVERCAST';
}
