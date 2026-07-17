"""IMD synoptic surface obs from the public GeoServer WFS: latest 3-hourly
SYNOP per station (~466) with total cloud in oktas, present weather, and rain
accumulations. Certs are broken in CI, so the fetch skips verification."""

import datetime
import json
import ssl
import urllib.request
from urllib.parse import urlencode

URL = "https://reactjs.imd.gov.in/geoserver/imd/wfs?" + urlencode({
    "service": "WFS", "version": "1.0.0", "request": "GetFeature",
    "typeName": "imd:synop_data_layer", "outputFormat": "application/json",
    "srsName": "EPSG:4326",
})


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def is_raining_wx(code):
    """WMO 4677: drizzle/rain 50-69, showers/thunder 80-99 (70-79 is snow)."""
    return code is not None and (50 <= code <= 69 or 80 <= code <= 99)


def fetch_synop():
    """{wmo_id(str): {"ok" oktas, "wx" code, "r3" mm, "t" utc-datetime}} or None."""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=120, context=ctx) as r:
            feats = json.load(r)["features"]
    except Exception:  # noqa: BLE001 — govt endpoint; absence is a normal state
        return None

    out = {}
    for f in feats:
        p = f["properties"]
        if p.get("station_id") is None:
            continue
        ok = _num(p.get("nebulosity"))
        wx = p.get("weather")
        try:
            d = datetime.date.fromisoformat(str(p["dat"]).rstrip("Z"))
            t = datetime.datetime(d.year, d.month, d.day, int(p["utc"]),
                                  tzinfo=datetime.timezone.utc)
        except (KeyError, TypeError, ValueError):
            t = None
        out[str(p["station_id"])] = {
            "ok": int(ok) if ok is not None and 0 <= ok <= 8 else None,
            "wx": int(wx) if isinstance(wx, (int, float)) else None,
            "r3": _num(p.get("3hrlyrain")),
            "t": t,
        }
    return out
