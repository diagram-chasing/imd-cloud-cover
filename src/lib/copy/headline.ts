// Generated daily headline from the national summary (spec A8).
import type { Summary } from '$lib/types';

const DOM_LABEL: Record<'h' | 'm' | 'l', string> = {
	h: 'HIGH AND THIN',
	m: 'MID-LEVEL',
	l: 'LOW AND HEAVY'
};

export interface Headline {
	headline: string;
	subline: string;
	stale: boolean;
}

function dominantBand(m: Summary['national_mean']): 'h' | 'm' | 'l' {
	if (m.h >= m.m && m.h >= m.l) return 'h';
	if (m.m >= m.l) return 'm';
	return 'l';
}

export function buildHeadline(summary: Summary, today: string): Headline {
	const n = summary.national_mean.total;
	const dom = DOM_LABEL[dominantBand(summary.national_mean)];

	let headline: string;
	if (n >= 70) {
		headline = `A BLANKET OVER ${n}% OF INDIA'S SKIES.`;
	} else if (n < 40) {
		headline = `MOSTLY OPEN SKIES: JUST ${n}% CLOUD OVER INDIA TODAY.`;
	} else {
		headline = `${n}% OF INDIA SITS UNDER CLOUD — MOST OF IT ${dom}.`;
	}

	const cloudiest = summary.cloudiest;
	const clearest = summary.clearest;
	const parts: string[] = [];
	if (cloudiest) parts.push(`Cloudiest: ${cloudiest.name} (${cloudiest.value}%)`);
	if (clearest) parts.push(`Clearest: ${clearest.name} (${clearest.value}%)`);

	// The forecast for `today` may come from an earlier run (day-0 of a previous
	// scrape's 10-day outlook) if today's scrape hasn't landed yet. That's still
	// current for the date — label it as issued-then, valid-now rather than stale.
	const issuedEarlier = Boolean(today) && today > summary.date;
	parts.push(
		issuedEarlier
			? `forecast for ${today}, issued ${summary.date} 11:00 IST`
			: `as of ${summary.date}, 11:00 IST`
	);
	const subline = parts.join(' · ');

	return { headline, subline, stale: issuedEarlier };
}
