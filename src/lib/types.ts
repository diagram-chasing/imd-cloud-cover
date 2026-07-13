// Schema types mirroring the pipeline's R2 outputs (scraper/aggregate.py).

export interface Station {
	name: string;
	state: string | null;
	lat: number;
	lon: number;
}

export interface StationsManifest {
	version: number;
	count: number;
	stations: Record<string, Station>;
}

/** GeoJSON `properties` of a baked place (src/lib/assets/geo/india-places.json).
 *  Feeds both the map label layer and the unified search. */
export interface PlaceProps {
	name: string;
	pop: number;
	state: string | null;
	/** Population bucket: 0 megacity … 3 town. */
	tier: number;
	/** Nearest IMD station code + rounded distance (km); precomputed at build. */
	nearest: string | null;
	nkm: number;
	aliases: string[];
}

export interface DatesIndex {
	dates: string[];
	latest: string;
}

/** One {h, m, l} value (0-100) per station code for the current view. */
export type BandValues = Record<string, { h: number; m: number; l: number }>;

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
