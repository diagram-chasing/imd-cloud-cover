"""Seed scraper/stations.json from the IMD meteograms page.

The IMD page embeds one Leaflet marker per station, of the form:

    var point = new L.LatLng(11.41,93.04);
    var marker = createMarker(point, '<div ...><b>ANDAMAN</b>...LAT : 11.41 ... LONG :93.04 ...',
                              '...pin.png')
    function loadN() { var load = window.open ('./gfs/.../ANDAMAN-meteogram.gif', ...); }

Each marker gives us code (from the gif path), display name (the <b>...</b>), and
lat/lon (the L.LatLng call). We stitch those together in document order.

State is not present on the page; when a states TopoJSON is available we assign
state via point-in-polygon (see --states), otherwise it is left null and can be
filled later.

Usage:
    python scraper/tools/seed_stations.py [--url URL] [--html FILE]
        [--states static/data/india.json] [--out scraper/stations.json] [--merge]

--merge keeps hand-edited lat/lon/state already present in the existing manifest,
only adding newly discovered codes and never clobbering non-null curated fields.
"""

import argparse
import json
import os
import re
import sys

DEFAULT_URL = "https://nwp.imd.gov.in/gfs_meteograms_mausam.php"

# One marker block = everything from a `new L.LatLng(...)` up to the next one.
LATLNG_RE = re.compile(r"new\s+L\.LatLng\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)")
NAME_RE = re.compile(r"<b>\s*([^<]+?)\s*</b>", re.IGNORECASE)
GIF_RE = re.compile(r"gfs/[a-zA-Z0-9_/-]+/([a-zA-Z0-9_-]+)-meteogram\.gif")


def parse_markers(html):
    """Return list of {code, name, lat, lon} in document order."""
    stations = []
    # Split so each chunk owns exactly one L.LatLng and the marker/load that follow it.
    matches = list(LATLNG_RE.finditer(html))
    for idx, m in enumerate(matches):
        start = m.start()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(html)
        chunk = html[start:end]

        lat = float(m.group(1))
        lon = float(m.group(2))

        gif = GIF_RE.search(chunk)
        if not gif:
            continue
        code = gif.group(1)

        name_match = NAME_RE.search(chunk)
        name = name_match.group(1).strip() if name_match else code
        # The IMD markers repeat the code as an all-caps <b> label; prettify it.
        name = prettify_name(name)

        stations.append({"code": code, "name": name, "lat": lat, "lon": lon})
    return stations


def prettify_name(raw):
    """ANDAMAN -> Andaman; A-MALWA -> A-Malwa; leave mixed-case names alone."""
    if raw.isupper() or raw.islower():
        parts = re.split(r"([\s\-_])", raw.lower())
        return "".join(p.capitalize() if p.strip() else p for p in parts).replace("_", " ")
    return raw


def load_states(path):
    """Load a TopoJSON/GeoJSON of India states for point-in-polygon state assignment.

    Returns a list of (state_name, list_of_rings) or None if unavailable.
    Only used when --states is passed and shapely-free ray casting is enough.
    """
    if not path or not os.path.exists(path):
        return None
    with open(path) as f:
        doc = json.load(f)

    features = []
    if doc.get("type") == "Topology":
        try:
            # Minimal TopoJSON decode without topojson lib: convert arcs.
            features = _topojson_to_features(doc)
        except Exception as e:  # pragma: no cover
            print(f"  (states topojson decode failed: {e})", file=sys.stderr)
            return None
    elif doc.get("type") == "FeatureCollection":
        features = doc["features"]
    else:
        return None

    out = []
    for feat in features:
        name = (
            feat.get("properties", {}).get("ST_NM")
            or feat.get("properties", {}).get("st_nm")
            or feat.get("properties", {}).get("name")
        )
        geom = feat.get("geometry")
        if not name or not geom:
            continue
        rings = []
        if geom["type"] == "Polygon":
            rings.append(geom["coordinates"][0])
        elif geom["type"] == "MultiPolygon":
            for poly in geom["coordinates"]:
                rings.append(poly[0])
        out.append((name, rings))
    return out


def _topojson_to_features(topo):
    """Decode a TopoJSON object into GeoJSON features (first object layer)."""
    arcs = topo["arcs"]
    transform = topo.get("transform")

    def decode_arc(i):
        reverse = i < 0
        if reverse:
            i = ~i
        arc = arcs[i]
        points = []
        if transform:
            sx, sy = transform["scale"]
            tx, ty = transform["translate"]
            x = y = 0
            for dx, dy in arc:
                x += dx
                y += dy
                points.append([x * sx + tx, y * sy + ty])
        else:
            points = [list(p) for p in arc]
        return points[::-1] if reverse else points

    def stitch(arc_indices):
        line = []
        for i in arc_indices:
            pts = decode_arc(i)
            if line:
                line.extend(pts[1:])
            else:
                line.extend(pts)
        return line

    features = []
    obj = next(iter(topo["objects"].values()))
    geoms = obj["geometries"] if obj["type"] == "GeometryCollection" else [obj]
    for g in geoms:
        gtype = g["type"]
        coords = None
        if gtype == "Polygon":
            coords = [stitch(ring) for ring in g["arcs"]]
        elif gtype == "MultiPolygon":
            coords = [[stitch(ring) for ring in poly] for poly in g["arcs"]]
        else:
            continue
        features.append(
            {"type": "Feature", "properties": g.get("properties", {}),
             "geometry": {"type": gtype, "coordinates": coords}}
        )
    return features


def point_in_ring(lon, lat, ring):
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if ((yi > lat) != (yj > lat)) and (
            lon < (xj - xi) * (lat - yi) / (yj - yi + 1e-12) + xi
        ):
            inside = not inside
        j = i
    return inside


def assign_state(lon, lat, states):
    for name, rings in states:
        for ring in rings:
            if point_in_ring(lon, lat, ring):
                return name
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--html", help="read from a local HTML file instead of fetching")
    ap.add_argument("--states", help="TopoJSON/GeoJSON of India states for state assignment")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "stations.json"))
    ap.add_argument("--merge", action="store_true", help="preserve curated fields in existing manifest")
    args = ap.parse_args()

    if args.html:
        with open(args.html, encoding="utf-8", errors="replace") as f:
            html = f.read()
    else:
        import requests

        print(f"Fetching {args.url} ...")
        html = requests.get(args.url, timeout=30, headers={"User-Agent": "Mozilla/5.0"}).text

    markers = parse_markers(html)
    print(f"Parsed {len(markers)} markers.")

    # Drop markers outside a generous India bounding box (stray/test pins).
    in_india = [m for m in markers if 6.0 <= m["lat"] <= 38.0 and 67.0 <= m["lon"] <= 98.0]
    dropped = [m["code"] for m in markers if m not in in_india]
    if dropped:
        print(f"Dropped {len(dropped)} out-of-bounds markers: {sorted(set(dropped))}")

    # De-dupe by code, keeping first occurrence.
    seen = {}
    for m in in_india:
        seen.setdefault(m["code"], m)
    stations = seen
    print(f"{len(stations)} unique station codes.")

    states = load_states(args.states) if args.states else None
    if states:
        print(f"Loaded {len(states)} state polygons for assignment.")

    existing = {}
    out_path = os.path.abspath(args.out)
    if args.merge and os.path.exists(out_path):
        with open(out_path) as f:
            existing = json.load(f).get("stations", {})

    result = {}
    n_stated = 0
    for code, m in sorted(stations.items()):
        prev = existing.get(code, {})
        lat = prev.get("lat") if prev.get("lat") is not None else m["lat"]
        lon = prev.get("lon") if prev.get("lon") is not None else m["lon"]
        state = prev.get("state")
        if state is None and states:
            state = assign_state(lon, lat, states)
        if state:
            n_stated += 1
        result[code] = {
            "name": prev.get("name") or m["name"],
            "state": state,
            "lat": round(lat, 4),
            "lon": round(lon, 4),
        }

    doc = {"version": 1, "count": len(result), "stations": result}
    with open(out_path, "w") as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"Wrote {len(result)} stations to {out_path} ({n_stated} with state).")


if __name__ == "__main__":
    main()
