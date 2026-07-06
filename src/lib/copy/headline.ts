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
	parts.push(`as of ${summary.date}, 11:00 IST`);
	let subline = parts.join(' · ');

	const stale = summary.date !== today;
	if (stale) {
		headline = `SHOWING ${summary.date} — ${headline}`;
		subline += ' (today’s scrape pending)';
	}

	return { headline, subline, stale };
}
