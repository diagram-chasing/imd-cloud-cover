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
	stations: Record<string, { h: (number | null)[]; m: (number | null)[]; l: (number | null)[]; p: (number | null)[]; e: (number | null)[] }>;
	national: { h: (number | null)[]; m: (number | null)[]; l: (number | null)[]; p: (number | null)[]; e: (number | null)[] };
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
