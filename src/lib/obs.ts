// Silent correction of the "now" frame against live observations
// (latest/obs.json): when the satellite/observer clearly disagree with the
// forecast, pull the shown bands toward what was actually observed, with
// trust fading over lead time. Applies only to the current IST day in the
// today view; every other frame passes through untouched.

import type { BandValues, ObsLatest, ObsStation } from '$lib/types';
import { effectiveCover as eff } from '$lib/format';

const MAX_AGE_MS = 2 * 3600 * 1000; // ignore obs older than this (job stalled)
const DISAGREE = 25; // cover-gap (points) below which the map is left alone
const W0 = 0.75; // trust in obs now, fading to 0 at MAX_LEAD steps
const MAX_LEAD = 3;
const RAIN_EFF_FLOOR = 45; // raining may not read "clear" (showers stay partly cloudy)
const SAT_ONLY = 0.5; // the binary satellite mask alone corrects at half strength

// WMO 4677 present weather: drizzle/rain 50-69, showers/thunder 80-99 (70-79 is snow)
const isRainWx = (wx?: number) => wx != null && ((wx >= 50 && wx <= 69) || wx >= 80);
const rainingNow = (o: ObsStation) => (o.rr ?? 0) >= 2 || (o.r3 ?? 0) >= 1 || isRainWx(o.wx);

const c100 = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

// Route an injected/topped-up correction to the OLR-observed layer. Mid is the
// default (and the least assertive band) whenever OLR can't place the cloud.
const LAYER_KEY = { high: 'h', mid: 'm', low: 'l' } as const;
const injectKey = (o: ObsStation): 'h' | 'm' | 'l' => LAYER_KEY[o.layer ?? 'mid'];

/** The current IST 3-h display step (0 = 00:00 … 7 = 21:00). */
export const nowStepIST = (now = Date.now()) =>
	Math.floor(new Date(now + 5.5 * 3600 * 1000).getUTCHours() / 3);

/** Today's date string in IST (matches data.ts's active-day resolution). */
export const istToday = (now = Date.now()) =>
	new Date(now + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

export function applyObs(
	values: BandValues,
	obs: ObsLatest | null,
	isActiveToday: boolean,
	timeIndex: number,
	now = Date.now()
): BandValues {
	if (!obs || !isActiveToday) return values;
	const age = now - Date.parse(obs.generated_at);
	if (!(age >= 0 && age <= MAX_AGE_MS)) return values;
	const lead = timeIndex - nowStepIST(now);
	if (lead < 0 || lead > MAX_LEAD) return values;
	const w = W0 * (1 - lead / MAX_LEAD);
	if (w <= 0) return values;

	// Untrusted satellite (per collect_obs's observer check) may only add
	// cloud at observer-less stations, never erase it.
	const satTrusted = obs.sources?.sat?.ok === true;

	const out: BandValues = {};
	for (const [code, v] of Object.entries(values)) {
		const o = obs.stations[code];
		let nv = v;
		if (o?.oc != null) {
			const ws = o.ok == null ? w * SAT_ONLY : w;
			const e = eff(v);
			const gap = o.oc - e;
			if (Math.abs(gap) > DISAGREE && !(gap < 0 && o.ok == null && !satTrusted)) {
				if (e >= 5) {
					const s = (e + ws * gap) / e;
					nv = { ...v, h: c100(v.h * s), m: c100(v.m * s), l: c100(v.l * s) };
					// bands clamp at 100 (cirrus counts only 0.45), so scaling can
					// undershoot; top up the observed layer (mid if unknown)
					if (gap > 0 && o.oc - eff(nv) > DISAGREE)
						nv[injectKey(o)] = Math.max(nv[injectKey(o)], c100(ws * o.oc));
				} else {
					// nothing to scale from a clear forecast; surface observed cloud
					// at the OLR-indicated layer (mid when unknown — least assertive)
					nv = { ...v, [injectKey(o)]: Math.max(v[injectKey(o)], c100(ws * o.oc)) };
				}
			}
		}
		if (o && rainingNow(o)) {
			nv = {
				...nv,
				l: eff(nv) < RAIN_EFF_FLOOR ? RAIN_EFF_FLOOR : nv.l,
				r: Math.max(nv.r ?? 0, Math.round(Math.max((o.rr ?? 0) * 3, o.r3 ?? 0, 1) * 10) / 10)
			};
		}
		out[code] = nv;
	}
	return out;
}
