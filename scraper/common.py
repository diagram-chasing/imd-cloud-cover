"""Small helpers shared across the scraper scripts: manifest access, numeric
coercion, geo distance, and fetching from govt endpoints with broken TLS."""

import json
import math
import os
import ssl
import urllib.request


def here(*parts):
    return os.path.join(os.path.dirname(__file__), *parts)


def load_manifest():
    with open(here("stations.json")) as f:
        return json.load(f)


def c100(v):
    """Clamp to an integer cover percentage 0..100."""
    return max(0, min(100, round(v)))


def to_float(v):
    """float(v) with junk and NaN coerced to None."""
    try:
        f = float(v)
        return None if math.isnan(f) else f
    except (TypeError, ValueError):
        return None


def insecure_get(url, timeout):
    """GET returning bytes, skipping TLS verification — several IMD/MOSDAC
    endpoints serve broken certificate chains in CI."""
    return insecure_get_meta(url, timeout)[0]


def insecure_get_meta(url, timeout):
    """Like insecure_get but also returns the response headers, so callers can
    read Last-Modified (IMD's static satellite JPEGs are overwritten in place;
    that header is the frame's timestamp)."""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
        return r.read(), r.headers


def haversine_km(lat1, lon1, lat2, lon2):
    rlat1, rlat2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin((rlat2 - rlat1) / 2) ** 2
         + math.cos(rlat1) * math.cos(rlat2)
         * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 6371 * 2 * math.asin(math.sqrt(a))
