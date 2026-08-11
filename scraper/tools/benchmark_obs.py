"""Score latest/obs.json against outside references (airport METARs +
Open-Meteo). Verification only — never feeds the map.

Usage: LOCAL_MODE=1 LOCAL_DIR=... python scraper/tools/benchmark_obs.py
"""

import datetime
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import requests  # noqa: E402
from dotenv import load_dotenv  # noqa: E402

from common import load_manifest  # noqa: E402
from storage import get_store, SHORT  # noqa: E402
from validate_sources import CONDITION_EDGES, category  # noqa: E402

load_dotenv()

# Indian airports with regular METARs, spread across the country.
AIRPORTS = ("VIDP VABB VOMM VECC VOBL VOHS VAAH VEGT VILK VIJP VAPO VANP "
            "VOTV VOCI VEPT VIAR VEBS VARK VOMD VABV VEIM VEAT VIBN VOVZ "
            "VIGR VEBD VOTR VAID VISR VOCB").split()
OKTA = {"FEW": 2, "SCT": 4, "BKN": 6, "OVC": 8, "OVX": 8,
        "CLR": 0, "SKC": 0, "NSC": 0, "CAVOK": 0}
MAX_MATCH_KM = 40
OPEN_METEO_N = 80


def km(lat1, lon1, lat2, lon2):
    """Rough great-circle distance in km."""
    dx = (lon2 - lon1) * math.cos(math.radians((lat1 + lat2) / 2)) * 111.32
    dy = (lat2 - lat1) * 110.57
    return math.hypot(dx, dy)


def fetch_metars():
    """[{icao, lat, lon, oktas}] for airports currently reporting sky cover."""
    r = requests.get("https://aviationweather.gov/api/data/metar",
                     params={"ids": ",".join(AIRPORTS), "format": "json"},
                     timeout=45)
    r.raise_for_status()
    out = []
    for m in r.json():
        covers = [c.get("cover") for c in m.get("clouds") or []]
        oktas = [OKTA[c] for c in covers if c in OKTA]
        if not oktas or m.get("lat") is None:
            continue
        out.append({"icao": m["icaoId"], "lat": m["lat"], "lon": m["lon"],
                    "oktas": max(oktas)})
    return out


def fetch_open_meteo(points):
    """[{code, cloud}] — model total cloud cover % at each (code, lat, lon)."""
    r = requests.get("https://api.open-meteo.com/v1/forecast", params={
        "latitude": ",".join(f"{p[1]:.3f}" for p in points),
        "longitude": ",".join(f"{p[2]:.3f}" for p in points),
        "current": "cloud_cover"}, timeout=45)
    r.raise_for_status()
    body = r.json()
    body = body if isinstance(body, list) else [body]
    return [{"code": p[0], "cloud": b["current"]["cloud_cover"]}
            for p, b in zip(points, body)]


def nearest_station(manifest, lat, lon):
    """(code, distance_km) of the closest station."""
    best, dist = None, 1e9
    for code, s in manifest["stations"].items():
        d = km(lat, lon, s["lat"], s["lon"])
        if d < dist:
            best, dist = code, d
    return best, dist


def score(pairs):
    """{n, bias, mae, within1} for [(ours, reference)] cloud-% pairs."""
    if not pairs:
        return {"n": 0, "bias": None, "mae": None, "within1": None}
    diffs = [a - b for a, b in pairs]
    within1 = sum(abs(category(a) - category(b)) <= 1 for a, b in pairs)
    return {"n": len(pairs),
            "bias": round(sum(diffs) / len(diffs)),
            "mae": round(sum(abs(d) for d in diffs) / len(diffs)),
            "within1": round(within1 / len(pairs), 2)}


def main():
    store = get_store()
    obs = store.get_json("latest/obs.json")
    if not obs:
        sys.exit("no latest/obs.json in the store")
    manifest = load_manifest()
    st = obs["stations"]

    metar_sc, metar_oc = [], []
    matched = 0
    try:
        metars = fetch_metars()
    except Exception as e:  # noqa: BLE001
        print(f"METAR fetch failed ({e!r}); skipping")
        metars = []
    for m in metars:
        code, d = nearest_station(manifest, m["lat"], m["lon"])
        row = st.get(code)
        if d > MAX_MATCH_KM or not row:
            continue
        matched += 1
        ref = m["oktas"] / 8 * 100
        if "sc" in row:
            metar_sc.append((row["sc"], ref))
        if "oc" in row:
            metar_oc.append((row["oc"], ref))

    with_sc = sorted(c for c, r in st.items() if "sc" in r)
    step = max(1, len(with_sc) // OPEN_METEO_N)
    picks = with_sc[::step][:OPEN_METEO_N]
    points = [(c, manifest["stations"][c]["lat"], manifest["stations"][c]["lon"])
              for c in picks]
    om_sc, om_oc = [], []
    try:
        for o in fetch_open_meteo(points):
            row = st[o["code"]]
            if "sc" in row:
                om_sc.append((row["sc"], o["cloud"]))
            if "oc" in row:
                om_oc.append((row["oc"], o["cloud"]))
    except Exception as e:  # noqa: BLE001
        print(f"Open-Meteo fetch failed ({e!r}); skipping")

    report = {
        "at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "obs_generated_at": obs["generated_at"],
        "sat_trust": (obs.get("sources") or {}).get("sat"),
        "metar": {"reporting": len(metars), "matched": matched,
                  "satellite_vs_metar": score(metar_sc),
                  "merged_vs_metar": score(metar_oc)},
        "open_meteo": {"points": len(points),
                       "satellite_vs_model": score(om_sc),
                       "merged_vs_model": score(om_oc)},
        "note": f"bias/mae in cloud-% points; within1 vs edges {list(CONDITION_EDGES)}",
    }
    stamp = report["at"].replace(":", "").replace("+0000", "Z")
    store.put_json(f"reports/benchmark/{stamp}.json", report, cache_control=SHORT)

    print(f"\nBenchmark @ {report['at']} (obs from {obs['generated_at']})")
    print(f"satellite trust check: {report['sat_trust']}")
    for name, block in (("METAR (airport observers)", report["metar"]),
                        ("Open-Meteo (model)", report["open_meteo"])):
        print(f"\n  vs {name}:")
        for key, s in block.items():
            if isinstance(s, dict):
                print(f"    {key:24s} n={s['n']:3d}  bias={s['bias']}  "
                      f"mae={s['mae']}  within-1-label={s['within1']}")
    print("\n(aim: |bias| small, mae under ~25, within-1-label >= 0.7)")


if __name__ == "__main__":
    main()
