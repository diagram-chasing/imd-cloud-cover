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

/** GeoJSON `properties` of a baked place (static/data/india-places.json).
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

/** One {h, m, l, p} value (0-100) per station code for the current view.
 *  p = relative precip intensity (auto-scaled per station; not absolute mm). */
export type BandValues = Record<string, { h: number; m: number; l: number; p: number }>;

/** latest/all-stations.json — today's 8-step day-0 slice per station. */
export interface AllStations {
	date: string;
	generated_at: string | null;
	steps: string[]; // ["00:00".."21:00"]
	stations: Record<string, StationBands>;
}

export interface StationBands {
	h: number[]; // length 8
	m: number[];
	l: number[];
	p: number[]; // relative precip intensity 0-100
}

export interface NamedValue {
	code: string;
	name: string;
	value: number;
}

export interface StreakEntry {
	code: string;
	name: string;
	days: number;
}

/** latest/summary.json */
export interface Summary {
	date: string;
	national_mean: { h: number; m: number; l: number; rain: number; total: number };
	cloudiest: NamedValue | null;
	clearest: NamedValue | null;
	wettest: NamedValue | null;
	streaks: { sun: StreakEntry[]; cloud: StreakEntry[] };
	station_count: number;
	failed_count: number;
}

/** Per-day daily means stored in history/{CODE}.json */
export interface DailyMeans {
	h: number;
	m: number;
	l: number;
	p: number; // relative precip intensity 0-100
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
			p: (number | null)[];
			e: (number | null)[];
		}
	>;
	national: {
		h: (number | null)[];
		m: (number | null)[];
		l: (number | null)[];
		p: (number | null)[];
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
	/** Monsoon arrival date, or null if the clouds haven't settled in yet. */
	onset: string | null;
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
	rain: number; // relative precip intensity 0-100
}

export interface Forecast {
	start_date: string;
	samples: number;
	data: ForecastPoint[];
}

export type ViewMode = 'today' | 'week' | 'month';
export type BandKey = 'high' | 'middle' | 'low';
