// Hand-curated public webcams for a handful of stations. Keyed by station code —
// the same key StationCard and the city page already carry — so the "Live webcam"
// link surfaces both in the map popover/drawer and on /stations/<slug> for that place.
//
// Link-out only: the feeds are third-party and wildly heterogeneous (a raw MJPEG
// stream, an HTTP-only page, full marketing pages), so we send visitors to the
// source rather than embedding it.

export interface Webcam {
	/** Live view, opened in a new tab. */
	url: string;
	/** Operator/source label shown beside the link. */
	source: string;
}

/** Station code → webcam. Codes picked so each lands on that place's canonical
 *  city page (MDS=Chennai, BNG=Bengaluru, SAFDARJUNG=Delhi, TIRUVANNAMALAI). */
export const WEBCAMS: Record<string, Webcam> = {
	MDS: { url: 'https://kwschennai.com/keacam.htm', source: 'KWS Chennai' },
	BNG: { url: 'https://view.custardlev.uk/video_feed', source: 'custardlev.uk' },
	SAFDARJUNG: { url: 'https://www.aqi.in/aqi-camera', source: 'AQI.in' },
	TIRUVANNAMALAI: { url: 'http://arunachala-live.com/window.html', source: 'Arunachala-live' }
};

/** The webcam for a station code, or null when none is curated. */
export function webcamFor(code?: string | null): Webcam | null {
	if (!code) return null;
	return WEBCAMS[code] ?? null;
}
