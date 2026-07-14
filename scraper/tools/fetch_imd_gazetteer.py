"""Cache IMD GeoServer WFS layers used to enrich the station manifest.

Downloads four layers as GeoJSON into scraper/data/imd/ so that seed_stations.py
can assign state/district (point-in-polygon) and real station names (coordinate
re-identification) offline and deterministically. Re-run occasionally to refresh.

Usage: python scraper/tools/fetch_imd_gazetteer.py
"""

import json
import os
import ssl
import sys
import urllib.request

WFS_BASE = "https://reactjs.imd.gov.in/geoserver/imd/wfs"

# typeName -> output filename. Ordered by how seed_stations.py uses them.
LAYERS = {
    "imd:india_districts": "india_districts.json",      # state + district polygons
    "imd:synop_data_layer": "synop_data_layer.json",    # real SYNOP station names
    "imd:metar_data_layer": "metar_data_layer.json",    # ICAO / airport names
    "imd:NowcastWarningStation": "nowcast_stations.json",  # nowcast station names
}

# Rough sanity floor per layer; a big drop signals the WFS changed.
MIN_FEATURES = {
    "imd:india_districts": 500,
    "imd:synop_data_layer": 300,
    "imd:metar_data_layer": 100,
    "imd:NowcastWarningStation": 800,
}


def here(*parts):
    return os.path.join(os.path.dirname(__file__), *parts)


def wfs_url(type_name):
    from urllib.parse import urlencode

    return WFS_BASE + "?" + urlencode({
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeName": type_name,
        "outputFormat": "application/json",
        "srsName": "EPSG:4326",
    })


def fetch(url):
    # IMD's cert chain isn't always complete in CI; the data is public, so skip verify.
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=180, context=ctx) as r:
        return json.load(r)


# Properties seed_stations.py needs from the district polygons; everything else is dropped.
DISTRICT_PROPS = ("state", "district", "subdivisio", "rmc_mc")


def _round_coords(c):
    """Round coordinates to ~11 m (4 dp). Halves the district file; ample for point-in-polygon."""
    if c and isinstance(c[0], (int, float)):
        return [round(c[0], 4), round(c[1], 4)]
    return [_round_coords(x) for x in c]


def slim_districts(doc):
    """Keep only the props + geometry seed_stations.py uses; the raw layer is ~100 MB."""
    feats = []
    for f in doc.get("features", []):
        p = f.get("properties", {})
        g = f.get("geometry") or {}
        feats.append({
            "type": "Feature",
            "properties": {k: p.get(k) for k in DISTRICT_PROPS},
            "geometry": {"type": g.get("type"), "coordinates": _round_coords(g.get("coordinates", []))},
        })
    return {"type": "FeatureCollection", "features": feats}


def main():
    out_dir = here("..", "data", "imd")
    os.makedirs(out_dir, exist_ok=True)

    failures = []
    for type_name, filename in LAYERS.items():
        try:
            doc = fetch(wfs_url(type_name))
        except Exception as e:  # noqa: BLE001 — report and keep going
            print(f"  {type_name}: FETCH FAILED ({e})", file=sys.stderr)
            failures.append(type_name)
            continue

        n = len(doc.get("features", []))
        floor = MIN_FEATURES.get(type_name, 1)
        flag = "" if n >= floor else f"  <-- below expected {floor}!"
        if type_name == "imd:india_districts":
            doc = slim_districts(doc)  # trim ~100 MB raw layer to what the seeder needs
        path = os.path.join(out_dir, filename)
        with open(path, "w") as f:
            json.dump(doc, f, separators=(",", ":"))
        print(f"  {type_name:32s} {n:5d} features -> {path}{flag}")
        if n < floor:
            failures.append(type_name)

    if failures:
        raise SystemExit(f"Some layers failed or looked wrong: {sorted(set(failures))}")
    print("Done.")


if __name__ == "__main__":
    main()
