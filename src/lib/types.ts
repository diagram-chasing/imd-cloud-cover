// Schema types mirroring the pipeline's R2 outputs (scraper/aggregate.py).

export interface Station {
	name: string;
	/** Station code (also the manifest key); present from manifest v3. */
	code?: string;
	state: string | null;
	/** IMD district / met subdivision the station falls in (manifest v3). */
	district?: string | null;
	subdivision?: string | null;
	lat: number;
	lon: number;
	/** District-headline population + tier (0 megacity … 3 town); for ranking/search. */
	pop?: number | null;
	tier?: number | null;
	/** Search aliases: district-headline city + exonyms (Bombay, Madras, …). */
	aliases?: string[];
	/** How `name` was resolved: synop|metar|nowcast|nwp_name|district|code|manual. */
	name_source?: string;
	/** False when this station shares a place with another (a district meteogram +
	 *  a point station); only the canonical one appears in search/explorer. Map shows all. */
	canonical?: boolean;
	/** Nearest WMO synop station id within 35 km (manifest v4); null = none.
	 *  Informational — obs are already joined per-code server-side. */
	wmo?: string | null;
}

export interface StationsManifest {
	version: number;
	count: number;
	stations: Record<string, Station>;
}

/** GeoJSON `properties` of a place feature. In the "place = station" model these
 *  are derived from the station manifest (see `$lib/places`), so each place IS a
 *  station: `nearest` is its own code and `nkm` is 0. Feeds the map label layer. */
export interface PlaceProps {
	name: string;
	pop: number;
	state: string | null;
	district?: string | null;
	/** Population bucket: 0 megacity … 3 town. */
	tier: number;
	/** The station this place is (its own code); `nkm` kept at 0 for the map layer. */
	nearest: string | null;
	nkm: number;
	aliases: string[];
}

export interface DatesIndex {
	dates: string[];
	latest: string;
}

/** One {h, m, l} value (0-100) per station code for the current view, plus
 *  forecast rain `r` (mm per 3 h, MausamGram MME) where the view carries it. */
export type BandValues = Record<string, { h: number; m: number; l: number; r?: number }>;

/** latest/all-stations.json — the day-0 slice per station, plus a short
 *  multi-day forecast tail so the client can render the visitor's *current*
 *  calendar day even before that day's scrape has run. */
export interface AllStations {
	/** Day-0 = the scrape/issue date (also where the raw meteogram files live). */
	date: string;
	generated_at: string | null;
	steps: string[]; // ["00:00".."21:00"]
	/** Day-0 bands (8 steps) per station. */
	stations: Record<string, StationBands>;
	/** Future calendar dates beyond `date` that `forecast` covers, ascending.
	 *  Absent on views baked before the forecast tail landed. */
	fdays?: string[];
	/** Per-station bands spanning `fdays`, day-major: 8 steps per fday, so each
	 *  array is `8 * fdays.length` long. Slice with `dayBands`. */
	forecast?: Record<string, StationBands>;
}

export interface StationBands {
	h: number[]; // length 8
	m: number[];
	l: number[];
	/** Forecast rain, mm per 3-h step (MausamGram MME numeric sidecar). Absent
	 *  on views baked before the numeric ingest landed, or when MausamGram was down. */
	r?: number[];
}

/** One station's near-real-time observations in latest/obs.json: merged cloud
 *  % (oc), satellite cloud % (sc), synop oktas (ok), satellite rain mm/hr
 *  (rr), synop 3-h rain mm (r3), present-weather code (wx). All optional —
 *  each source can be down. */
export interface ObsStation {
	oc?: number;
	sc?: number;
	ok?: number;
	rr?: number;
	r3?: number;
	wx?: number;
}

/** latest/obs.json — written every ~30 min by scraper/collect_obs.py. */
export interface ObsLatest {
	generated_at: string;
	sources: { synop: string | null; cmk: string | null; hem: string | null };
	stations: Record<string, ObsStation>;
}

export interface NamedValue {
	code: string;
	name: string;
	value: number;
}

/** latest/summary.json */
export interface Summary {
	date: string;
	national_mean: { h: number; m: number; l: number; total: number };
	cloudiest: NamedValue | null;
	clearest: NamedValue | null;
	station_count: number;
	failed_count: number;
}

/** Per-day daily means stored in history/{CODE}.json */
export interface DailyMeans {
	h: number;
	m: number;
	l: number;
	e: number; // effective = mean of per-step max
	/** 8-step effective series (max of h/m/l per step). Absent on days written
	 *  before the pipeline started recording it. */
	t?: number[];
}

export interface History {
	code: string;
	kind: string;
	days: Record<string, DailyMeans>;
}

/** rollups/7d.json, rollups/30d.json — per-station daily-mean series over a window. */
export interface Rollup {
	window: number;
	dates: string[];
	stations: Record<
		string,
		{
			h: (number | null)[];
			m: (number | null)[];
			l: (number | null)[];
			e: (number | null)[];
		}
	>;
	national: {
		h: (number | null)[];
		m: (number | null)[];
		l: (number | null)[];
		e: (number | null)[];
	};
}

/** A calendar-consecutive run of days (streaks/records in rollups/cities.json). */
export interface CityRun {
	len: number;
	start: string;
	end: string;
}

/** One city in rollups/cities.json, keyed by its nearest station's code. */
export interface CityStats {
	name: string;
	state: string | null;
	district?: string | null;
	pop: number;
	tier: number;
	/** Daily effective cover aligned to the rollup's `dates`; null = no reading. */
	e: (number | null)[];
	mean: number;
	/** 1 = cloudiest long-term mean. */
	rank: number;
	/** Days with a reading. */
	n: number;
	counts: { clear: number; mixed: number; grey: number };
	runs: { clear: CityRun | null; grey: CityRun | null };
	/** Longest run without a clear day ("sun drought"). */
	drought: CityRun | null;
	/** Sky twins: `today` matches the latest day's 8-step profile (lowest RMSE),
	 * `alltime` the best long-term anomaly correlation. Either can be null when no
	 * far, different-state city qualifies. `km`/`r`/`rmse` are absent in rollups
	 * baked before those fields landed. */
	twin: {
		today: TwinRef | null;
		alltime: TwinRef | null;
	} | null;
}

/** A single sky-twin reference: the paired city's station code plus the metric
 * that earned it (`rmse` for today's profile, `r` for the long-term anomaly). */
export interface TwinRef {
	code: string;
	km?: number;
	r?: number;
	rmse?: number;
}

/** rollups/cities.json — the long-term city explorer view. */
export interface CitiesRollup {
	generated: string;
	dates: string[];
	records: {
		clear: (CityRun & { code: string }) | null;
		grey: (CityRun & { code: string }) | null;
	};
	cities: Record<string, CityStats>;
}

/** Raw per-station forecast: {date}/{CODE}-meteogram.json */
export interface ForecastPoint {
	datetime: string;
	high: number;
	middle: number;
	low: number;
}

export interface Forecast {
	start_date: string;
	data: ForecastPoint[];
}

export type ViewMode = 'today' | 'week' | 'month';
export type BandKey = 'high' | 'middle' | 'low';
