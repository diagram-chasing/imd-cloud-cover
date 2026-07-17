"""Link manifest stations to their nearest WMO synop station (manifest v4).

Each station gets the nearest point from the cached synop gazetteer
(scraper/data/imd/synop_data_layer.json) within LINK_MAX_KM, else wmo: null.
Many-to-one is expected (district meteogram + its city point share one synop).
Re-run after reseeding stations. Usage: python scraper/tools/link_synop_wmo.py
"""

import datetime
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from common import haversine_km  # noqa: E402

LINK_MAX_KM = 35


def here(*parts):
    return os.path.join(os.path.dirname(__file__), *parts)


def main():
    with open(here("..", "data", "imd", "synop_data_layer.json")) as f:
        points = [(str(p["properties"]["station_id"]),
                   p["geometry"]["coordinates"][1], p["geometry"]["coordinates"][0])
                  for p in json.load(f)["features"]
                  if p["properties"].get("station_id") is not None and p.get("geometry")]

    path = here("..", "stations.json")
    with open(path) as f:
        manifest = json.load(f)

    linked = 0
    for s in manifest["stations"].values():
        best, best_km = None, LINK_MAX_KM
        for wmo, plat, plon in points:
            km = haversine_km(s["lat"], s["lon"], plat, plon)
            if km < best_km:
                best, best_km = wmo, km
        s["wmo"] = best
        linked += best is not None

    manifest["version"] = 4
    manifest.setdefault("sources", {})["wmo_link"] = {
        "layer": "imd:synop_data_layer", "max_km": LINK_MAX_KM,
        "linked": linked, "date": datetime.date.today().isoformat(),
    }
    with open(path, "w") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"linked {linked}/{len(manifest['stations'])} -> {path} (v4)")


if __name__ == "__main__":
    main()
