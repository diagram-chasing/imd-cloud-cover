"""Score the displayed forecast against observations for one date.

Compares three things per station-hour:
  - the ANCHORED meteogram bands (what the map displays) vs synop oktas
  - forecast rain (MME apcp) vs synop present-weather/rain
  - raw meteogram effective cover vs MME total cloud (model-vs-OCR gap)

Inputs come from the store: {date}/{code}-meteogram.json, {date}/numeric.json,
obs/archive/{date}.json (written by collect_obs.py). Output goes to
reports/validation/{date}.json plus a console summary.

Usage: LOCAL_MODE=1 LOCAL_DIR=... python scraper/tools/validate_sources.py [--date YYYY-MM-DD]
"""

import argparse
import datetime
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv  # noqa: E402

from aggregate import codes_for_date, read_slices, effective  # noqa: E402
from anchor import apply_anchoring  # noqa: E402
from storage import get_store, SHORT  # noqa: E402
from synop import is_raining_wx  # noqa: E402

load_dotenv()

# Same category edges as the frontend's skyCondition (format.ts).
CONDITION_EDGES = (13, 38, 63, 88)
TARGET_WITHIN1 = 0.70
RAIN_FORECAST_MM = 1.0   # mm/3h; matches theme.ts rainTier's first bin
RAIN_OBS_MM = 1.0        # synop 3-h accumulation that counts as raining


def category(cover):
    """0 CLEAR .. 4 OVERCAST."""
    for i, edge in enumerate(CONDITION_EDGES):
        if cover < edge:
            return i
    return len(CONDITION_EDGES)


def display_eff(bands, mval):
    """Effective cover as the frontend weighs it."""
    return max(bands["l"][mval], bands["m"][mval] * 0.8, bands["h"][mval] * 0.45)


def step_for(t_iso):
    """Snapshot UTC time -> nearest IST 3-h display step 0..7, or None."""
    try:
        t = datetime.datetime.fromisoformat(t_iso)
    except ValueError:
        return None
    ist = t + datetime.timedelta(hours=5, minutes=30)
    return min(7, round((ist.hour + ist.minute / 60) / 3) % 8)


def obs_is_raining(row):
    return (row.get("r3") or 0) >= RAIN_OBS_MM or is_raining_wx(row.get("wx"))


def validate(store, date):
    codes = codes_for_date(store, date)
    slices = read_slices(store, date, codes)
    numeric = store.get_json(f"{date}/numeric.json")
    archive = store.get_json(f"obs/archive/{date}.json")

    # model-vs-OCR gap on the RAW bands, before anchoring mutates them
    mae_n, mae_sum = 0, 0.0
    if numeric:
        for code, b in slices.items():
            num = numeric["stations"].get(code)
            if not num:
                continue
            eff = effective(b)
            for i, tc in enumerate(num["tc"][: len(eff)]):
                if tc is not None:
                    mae_sum += abs(eff[i] - tc)
                    mae_n += 1

    apply_anchoring(slices, numeric)

    within1 = total = 0
    rain_obs_hits = rain_obs_total = 0
    rain_fc_dry_obs = rain_fc_total = 0
    per_snapshot = []
    for snap in (archive or {}).get("snapshots", []):
        step = step_for(snap["t"])
        if step is None:
            continue
        n_snap = 0
        for code, row in snap["stations"].items():
            b = slices.get(code)
            if not b or len(b["h"]) <= step:
                continue
            fc_rain = (numeric and (numeric["stations"].get(code) or {}).get("p")
                       and (numeric["stations"][code]["p"][step] or 0) >= RAIN_FORECAST_MM)
            if row.get("ok") is not None:
                gap = abs(category(display_eff(b, step)) - category(row["ok"] / 8 * 100))
                within1 += gap <= 1
                total += 1
                n_snap += 1
            raining = obs_is_raining(row)
            if raining:
                rain_obs_total += 1
                rain_obs_hits += bool(fc_rain)
            if fc_rain and (row.get("ok") is not None or row.get("wx") is not None):
                rain_fc_total += 1
                rain_fc_dry_obs += not raining
        per_snapshot.append({"t": snap["t"], "step": step, "scored": n_snap,
                             "sources": snap.get("sources")})

    report = {
        "date": date,
        "stations": len(slices),
        "anchoring": {"available": bool(numeric),
                      "meteogram_vs_mme_mae": round(mae_sum / mae_n, 1) if mae_n else None},
        "cloud": {"scored": total,
                  "within1": round(within1 / total, 3) if total else None,
                  "target": TARGET_WITHIN1},
        "rain": {"obs_raining": rain_obs_total,
                 "hit_rate": round(rain_obs_hits / rain_obs_total, 3)
                 if rain_obs_total else None,
                 "forecast_raining": rain_fc_total,
                 "false_alarm_rate": round(rain_fc_dry_obs / rain_fc_total, 3)
                 if rain_fc_total else None},
        "snapshots": per_snapshot,
    }
    return report


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="date to score (YYYY-MM-DD); default today")
    args = ap.parse_args()
    date = args.date or datetime.date.today().isoformat()

    store = get_store()
    report = validate(store, date)
    store.put_json(f"reports/validation/{date}.json", report, cache_control=SHORT)

    c, r, a = report["cloud"], report["rain"], report["anchoring"]
    print(f"{date}: cloud within-1-category {c['within1']} "
          f"({c['scored']} station-hours, target {c['target']}) | "
          f"rain hit {r['hit_rate']} of {r['obs_raining']}, "
          f"false-alarm {r['false_alarm_rate']} of {r['forecast_raining']} | "
          f"meteogram-vs-MME MAE {a['meteogram_vs_mme_mae']}")
    if c["within1"] is not None and c["within1"] < TARGET_WITHIN1:
        print("WARNING: cloud agreement below target (not failing; tune thresholds "
              "after a few weeks of archives)")


if __name__ == "__main__":
    main()
