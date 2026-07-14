"""Seed scraper/stations.json from the IMD meteograms page, enriched with IMD-native
geography. Parses Leaflet markers (code, lat/lon) from the nwp page, then:
  * assigns state + district + subdivision by point-in-polygon against IMD's own
    imd:india_districts layer (authoritative, covers disputed areas + islands);
  * resolves a real station name by coordinate re-identification against IMD's
    synop/metar/nowcast station layers (the nwp popup only repeats the code);
  * folds a district-headline population + tier + search aliases onto each station
    from a GeoNames settlement gazetteer, guarded by the IMD district.

--merge preserves fields whose *_source is "manual" (hand edits) in an existing manifest.

Usage:
  python scraper/tools/fetch_imd_gazetteer.py      # refresh scraper/data/imd/ snapshots
  python scraper/tools/seed_stations.py --merge \\
      --districts ../data/imd/india_districts.json \\
      --gazetteers ../data/imd/synop_data_layer.json,../data/imd/metar_data_layer.json,../data/imd/nowcast_stations.json \\
      --places ../data/geonames-places.json
"""

import argparse
import datetime
import json
import math
import os
import re
import sys

DEFAULT_URL = "https://nwp.imd.gov.in/gfs_meteograms_mausam.php"
HERE = os.path.dirname(__file__)

# Which property holds the human-readable name in each gazetteer layer, and the
# short source tag recorded on the station. Order = match priority (best first).
GAZETTEER_NAME_KEY = {
    "synop_data_layer": ("station", "synop"),
    "metar_data_layer": ("station_name", "metar"),
    "nowcast_stations": ("Station", "nowcast"),
}

# Auto-derived name/state sources; anything else (e.g. "manual") is a human edit.
AUTO_NAME_SOURCES = {"synop", "metar", "nowcast", "nwp_popup", "code"}

# Curated clean names for major metros. The traditional in-city observatory gets the
# bare city name; co-located airport/suburb stations get a locality qualifier. These
# win over everything (name_source="manual") and set the canonical station for the
# place, so the other co-located stations collapse under them in search/explorer.
MANUAL_NAMES = {
    "CLB": "Mumbai", "SCZ": "Mumbai (Santacruz)", "BMB": "Mumbai (Santacruz)",
    "SAFDARJUNG": "Delhi", "SFD": "Delhi", "PALAM": "Delhi (Palam)", "PLM": "Delhi (Palam)",
    "REDFORT": "Delhi (Red Fort)",
    "BNG": "Bengaluru",
    "HYD": "Hyderabad",
    "MDS": "Chennai", "NGB": "Chennai (Meenambakkam)",
    "ALP": "Kolkata", "DDM": "Kolkata (Dum Dum)",
    "AHM": "Ahmedabad",
    "PNE": "Pune",
    "JPR": "Jaipur",
    "LKN": "Lucknow", "USI": "Lucknow (Airport)",
    "KNP": "Kanpur",
    "SON": "Nagpur",
    "SRT": "Surat",
    "BHP": "Bhopal",
    "PTN": "Patna",
    "CHD": "Chandigarh",
    "IND": "Indore", "VSK": "Visakhapatnam", "CMB": "Coimbatore", "TRV": "Thiruvananthapuram",
    "BRD": "Vadodara", "LDN": "Ludhiana", "VNS": "Varanasi", "AMR": "Amritsar",
    "NSK": "Nashik", "RJK": "Rajkot", "GHT": "Guwahati", "MYS": "Mysuru",
}

# Lower = kept as the canonical station when several share a name+state.
NAME_SOURCE_RANK = {
    "manual": 0, "synop": 1, "metar": 2, "nowcast": 3,
    "nwp_name": 4, "nwp_popup": 4, "district": 5, "geonames_district": 6, "code": 7,
}

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
        # Blue markers are district meteograms (gfs_meteograms_dist/); IMD names them
        # by district, often abbreviated (DAKSHINA-KANNAD). Flag them so we can use the
        # clean district field instead.
        is_dist = "gfs_meteograms_dist" in gif.group(0)

        name_match = NAME_RE.search(chunk)
        name = name_match.group(1).strip() if name_match else code
        # The IMD markers repeat the code as an all-caps <b> label; prettify it.
        name = prettify_name(name)

        stations.append({"code": code, "name": name, "lat": lat, "lon": lon, "is_dist": is_dist})
    return stations


def prettify_name(raw):
    """ANDAMAN -> Andaman; A-MALWA -> A-Malwa; leave mixed-case names alone."""
    if raw.isupper() or raw.islower():
        parts = re.split(r"([\s\-_])", raw.lower())
        return "".join(p.capitalize() if p.strip() else p for p in parts).replace("_", " ")
    return raw


def load_states(path):
    """load TopoJSON/GeoJSON of India states for point-in-polygon assignment; None if unavailable."""
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


def haversine_km(lat1, lon1, lat2, lon2):
    r = math.radians
    dlat = r(lat2 - lat1)
    dlon = r(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(r(lat1)) * math.cos(r(lat2)) * math.sin(dlon / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(a))


def _ring_bbox(rings):
    xs = [p[0] for ring in rings for p in ring]
    ys = [p[1] for ring in rings for p in ring]
    return min(xs), min(ys), max(xs), max(ys)


def load_districts(path):
    """IMD imd:india_districts GeoJSON -> [(state, district, subdivision, rings, bbox)]."""
    if not path or not os.path.exists(path):
        return None
    with open(path) as f:
        doc = json.load(f)
    out = []
    for feat in doc.get("features", []):
        p = feat.get("properties", {})
        geom = feat.get("geometry") or {}
        rings = []
        if geom.get("type") == "Polygon":
            rings.append(geom["coordinates"][0])
        elif geom.get("type") == "MultiPolygon":
            for poly in geom["coordinates"]:
                rings.append(poly[0])
        if not rings:
            continue
        out.append((p.get("state"), p.get("district"), p.get("subdivisio"),
                    rings, _ring_bbox(rings)))
    return out


def assign_admin(lon, lat, districts, snap_km=0):
    """Return (state, district, subdivision) for the district containing the point.

    If no polygon contains it and snap_km > 0, snap to the nearest district within
    snap_km (handles coastal/island points that sit just offshore of the boundary).
    """
    for state, district, subdivision, rings, (x0, y0, x1, y1) in districts:
        if lon < x0 or lon > x1 or lat < y0 or lat > y1:
            continue
        for ring in rings:
            if point_in_ring(lon, lat, ring):
                return state, district, subdivision
    if snap_km:
        best, best_d = None, snap_km
        for state, district, subdivision, rings, _bbox in districts:
            for ring in rings:
                for px, py in ring:
                    d = haversine_km(lat, lon, py, px)
                    if d < best_d:
                        best_d, best = d, (state, district, subdivision)
        if best:
            return best
    return None, None, None


def load_gazetteers(paths):
    """Ordered list of {source, points:[(name, lat, lon)]} for coordinate name-matching."""
    layers = []
    for path in paths:
        if not os.path.exists(path):
            print(f"  (gazetteer missing, skipping: {path})", file=sys.stderr)
            continue
        stem = os.path.splitext(os.path.basename(path))[0]
        name_key, source = GAZETTEER_NAME_KEY.get(stem, ("station", stem))
        with open(path) as f:
            doc = json.load(f)
        points = []
        for feat in doc.get("features", []):
            c = (feat.get("geometry") or {}).get("coordinates")
            name = (feat.get("properties") or {}).get(name_key)
            if c and name and str(name).strip():
                points.append((str(name).strip(), c[1], c[0]))
        layers.append({"source": source, "points": points})
    return layers


def match_name(lon, lat, gazetteers, max_km):
    """Nearest gazetteer name within max_km, searching layers in priority order."""
    for layer in gazetteers:
        best, best_d = None, max_km
        for name, plat, plon in layer["points"]:
            d = haversine_km(lat, lon, plat, plon)
            if d < best_d:
                best_d, best = d, name
        if best is not None:
            return best, layer["source"]
    return None, None


def load_places(path):
    """GeoNames settlement gazetteer -> [(name, lat, lon, pop, tier, state, aliases)]."""
    if not path or not os.path.exists(path):
        return None
    with open(path) as f:
        doc = json.load(f)
    out = []
    for feat in doc.get("features", []):
        p = feat.get("properties", {})
        c = (feat.get("geometry") or {}).get("coordinates")
        if not c:
            continue
        out.append((p.get("name"), c[1], c[0], p.get("pop") or 0,
                    p.get("tier"), p.get("state"), p.get("aliases") or []))
    return out


def district_headlines(places, districts):
    """Most populous settlement per IMD district -> {(state, district): place_tuple}."""
    best = {}
    for place in places:
        name, lat, lon, pop, tier, _state, _aliases = place
        state, district, _sub = assign_admin(lon, lat, districts)
        if district is None:
            continue
        key = (state, district)
        if key not in best or pop > best[key][3]:
            best[key] = place
    return best


def title_case(s):
    """KARNATAKA -> Karnataka; NEW DELHI -> New Delhi; keep parenthetical tags like (UT)."""
    if not s:
        return s
    def cap(w):
        if w.startswith("(") and w.endswith(")"):
            return w.upper()  # (UT), (LEH) — administrative tags stay upper
        return w.capitalize()
    return " ".join(cap(w) for w in s.split())


def _default(*parts):
    return os.path.join(HERE, *parts)


def _station_aliases(station_name, headline):
    """Search aliases: the district's headline city name + its exonyms (Bombay, ...)."""
    if not headline:
        return []
    out, seen = [], {norm_key(station_name)}
    for a in [headline[0], *headline[6]]:
        k = norm_key(a)
        if a and k and k not in seen:
            seen.add(k)
            out.append(a)
    return out


def norm_key(s):
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--html", help="read from a local HTML file instead of fetching")
    ap.add_argument("--states", help="legacy TopoJSON/GeoJSON of India states (fallback only)")
    ap.add_argument("--districts", default=_default("..", "data", "imd", "india_districts.json"),
                    help="IMD imd:india_districts GeoJSON for state+district assignment")
    ap.add_argument("--gazetteers",
                    default=",".join(_default("..", "data", "imd", f + ".json")
                                     for f in ("synop_data_layer", "metar_data_layer", "nowcast_stations")),
                    help="comma list of IMD station-name layers, priority order")
    ap.add_argument("--places", default=_default("..", "data", "geonames-places.json"),
                    help="GeoNames settlement gazetteer for district-headline population")
    ap.add_argument("--match-km", type=float, default=2.0,
                    help="max distance (km) for coordinate name re-identification")
    ap.add_argument("--out", default=_default("..", "stations.json"))
    ap.add_argument("--merge", action="store_true", help="preserve manual edits in existing manifest")
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

    # IMD-native geography sources.
    districts = load_districts(args.districts)
    if districts:
        print(f"Loaded {len(districts)} IMD district polygons.")
    states = load_states(args.states) if args.states else None
    gazetteers = load_gazetteers(args.gazetteers.split(",")) if args.gazetteers else []
    if gazetteers:
        print("Loaded name gazetteers: " + ", ".join(
            f"{g['source']}({len(g['points'])})" for g in gazetteers))
    places = load_places(args.places)
    headlines = {}
    if places and districts:
        headlines = district_headlines(places, districts)
        print(f"Loaded {len(places)} settlements -> {len(headlines)} district headlines.")

    existing = {}
    out_path = os.path.abspath(args.out)
    if args.merge and os.path.exists(out_path):
        with open(out_path) as f:
            existing = json.load(f).get("stations", {})

    result = {}
    name_srcs, state_srcs = {}, {}
    for code, m in sorted(stations.items()):
        prev = existing.get(code, {})
        lat = round(prev.get("lat") if prev.get("lat") is not None else m["lat"], 4)
        lon = round(prev.get("lon") if prev.get("lon") is not None else m["lon"], 4)

        # State / district / subdivision from IMD's own boundaries (authoritative).
        # Snap coastal/island points that sit just offshore to the nearest district.
        if prev.get("state_source") == "manual":
            state, district, subdivision = prev.get("state"), prev.get("district"), prev.get("subdivision")
            state_source = "manual"
        else:
            state, district, subdivision = (None, None, None)
            if districts:
                state, district, subdivision = assign_admin(lon, lat, districts, snap_km=30)
            if state is None and states:  # legacy fallback
                state = assign_state(lon, lat, states)
            state_source = "india_districts" if district is not None else (
                "legacy_states" if state else "none")

        # Real name resolution, best first:
        #   manual edit -> IMD gazetteer coordinate match -> the nwp label if it is a
        #   real place name -> for opaque codes, the district's headline city, then the
        #   district name -> finally the prettified code.
        headline = headlines.get((state, district)) if district is not None else None
        if prev.get("name_source") == "manual":
            name, name_source = prev["name"], "manual"
        elif m.get("is_dist") and district:
            # District meteogram: use the clean IMD district field rather than IMD's
            # abbreviated marker label (DAKSHINA-KANNAD -> Dakshina Kannada).
            name, name_source = title_case(district), "district"
        else:
            name, name_source = match_name(lon, lat, gazetteers, args.match_km)
            if name is None:
                opaque = bool(re.fullmatch(r"[A-Z0-9]{2,4}", m["code"]))
                if not opaque:
                    name, name_source = m["name"], "nwp_name"   # e.g. VISAKHAPATNAM, GURUVAYUR
                elif district:
                    # The district name is always correct; a headline city could sit in
                    # a different part of a large/multi-island district (e.g. Minicoy).
                    name, name_source = title_case(district), "district"  # TMK -> Tumakuru
                elif headline:
                    name, name_source = headline[0], "geonames_district"
                else:
                    name, name_source = m["name"], "code"

        # Curated clean name for major metros overrides everything.
        if code in MANUAL_NAMES:
            name, name_source = MANUAL_NAMES[code], "manual"

        # District-headline population + tier + search aliases.
        pop = headline[3] if headline else None
        tier = headline[4] if headline else None
        aliases = _station_aliases(name, headline)

        name_srcs[name_source] = name_srcs.get(name_source, 0) + 1
        state_srcs[state_source] = state_srcs.get(state_source, 0) + 1
        result[code] = {
            "name": name,
            "code": code,
            "state": state,
            "district": district,
            "subdivision": subdivision,
            "lat": lat,
            "lon": lon,
            "pop": pop,
            "tier": tier,
            "aliases": aliases,
            "name_source": name_source,
            "state_source": state_source,
        }

    # Collapse duplicates: many places have both a district-wide meteogram and a
    # point station (same name + state). Mark one canonical (prefer a point
    # observation over a district meteogram); search/explorer show only canonical
    # ones, the map still shows all.
    groups = {}
    for code, s in result.items():
        groups.setdefault((norm_key(s["name"]), s["state"] or ""), []).append(code)
    n_canon = 0
    for codes_in in groups.values():
        best = min(codes_in, key=lambda c: (
            NAME_SOURCE_RANK.get(result[c]["name_source"], 9),
            -(result[c]["pop"] or 0), c))
        for c in codes_in:
            result[c]["canonical"] = c == best
        n_canon += 1

    doc = {
        "version": 3,
        "count": len(result),
        "canonical_count": n_canon,
        "generated_at": datetime.datetime.now(datetime.timezone.utc)
        .replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "sources": {
            "districts": "imd:india_districts",
            "gazetteer": [g["source"] for g in gazetteers],
            "population": "GeoNames (district headline)",
        },
        "stations": result,
    }
    with open(out_path, "w") as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"Wrote {len(result)} stations to {out_path}.")
    print(f"  canonical:    {n_canon} unique places ({len(result) - n_canon} collapsed as duplicates)")
    print("  name_source:  " + ", ".join(f"{k}={v}" for k, v in sorted(name_srcs.items())))
    print("  state_source: " + ", ".join(f"{k}={v}" for k, v in sorted(state_srcs.items())))

    # Guard: no domestic (in-bbox) station may ship without a state/UT.
    stateless = [c for c, s in result.items()
                 if s["state"] is None and 6.0 <= s["lat"] <= 38.0 and 67.0 <= s["lon"] <= 98.0]
    if stateless:
        print(f"  WARNING: {len(stateless)} in-India stations have no state: {sorted(stateless)}",
              file=sys.stderr)


if __name__ == "__main__":
    main()
