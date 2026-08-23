"""Byte store keyed by path-like strings — R2Store (production, boto3) or
LocalStore (LOCAL_MODE=1, plain directory) — plus the small helpers every
script shares: station manifest access, numeric coercion, geo distance, and
fetching from govt endpoints with broken TLS. Pick a store with get_store().
"""

import json
import math
import os
import ssl
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO

MAX_WORKERS = 16

# Cache-Control policy by key prefix: dated snapshots never change,
# rolling/latest views change daily and get a short TTL.
IMMUTABLE = "public, max-age=31536000, immutable"
SHORT = "public, max-age=300"


def pmap(fn, items):
    """Map `fn` over `items` concurrently, preserving order. Empty-safe."""
    items = list(items)
    if not items:
        return []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        return list(ex.map(fn, items))


def cache_control_for(key):
    head = key.split("/", 1)[0]
    if head in ("latest", "meta", "rollups", "summary", "reports"):
        return SHORT
    return IMMUTABLE


class Store:
    def get_bytes(self, key):
        raise NotImplementedError

    def put_bytes(self, key, data, content_type, cache_control=None):
        raise NotImplementedError

    def list_keys(self, prefix):
        raise NotImplementedError

    def list_prefixes(self, prefix="", delimiter="/"):
        raise NotImplementedError

    def get_json(self, key):
        raw = self.get_bytes(key)
        if raw is None:
            return None
        return json.loads(raw.decode("utf-8"))

    def put_json(self, key, obj, cache_control=None, indent=None):
        data = json.dumps(obj, ensure_ascii=False, separators=(",", ":") if indent is None else None,
                          indent=indent).encode("utf-8")
        self.put_bytes(key, data, "application/json", cache_control)

    def put_fileobj(self, buffer, key, content_type, cache_control=None):
        buffer.seek(0)
        self.put_bytes(key, buffer.read(), content_type, cache_control)


class LocalStore(Store):
    def __init__(self, root="weather_data"):
        self.root = root

    def _path(self, key):
        return os.path.join(self.root, key)

    def get_bytes(self, key):
        path = self._path(key)
        if not os.path.exists(path):
            return None
        with open(path, "rb") as f:
            return f.read()

    def put_bytes(self, key, data, content_type, cache_control=None):
        path = self._path(key)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)

    def list_keys(self, prefix):
        out = []
        for dirpath, _dirs, files in os.walk(self.root):
            for name in files:
                full = os.path.join(dirpath, name)
                rel = os.path.relpath(full, self.root).replace(os.sep, "/")
                if rel.startswith(prefix):
                    out.append(rel)
        return sorted(out)

    def list_prefixes(self, prefix="", delimiter="/"):
        search = os.path.join(self.root, prefix)
        if not os.path.isdir(search):
            return []
        out = []
        for name in os.listdir(search):
            if os.path.isdir(os.path.join(search, name)):
                out.append(f"{prefix}{name}{delimiter}")
        return sorted(out)


class R2Store(Store):
    def __init__(self, client, bucket):
        self.s3 = client
        self.bucket = bucket

    def get_bytes(self, key):
        from botocore.exceptions import ClientError

        try:
            resp = self.s3.get_object(Bucket=self.bucket, Key=key)
            return resp["Body"].read()
        except ClientError as e:
            if e.response["Error"]["Code"] in ("NoSuchKey", "404", "NoSuchBucket"):
                return None
            raise

    def put_bytes(self, key, data, content_type, cache_control=None):
        extra = {"ContentType": content_type}
        cc = cache_control or cache_control_for(key)
        if cc:
            extra["CacheControl"] = cc
        self.s3.upload_fileobj(BytesIO(data), self.bucket, key, ExtraArgs=extra)

    def list_keys(self, prefix):
        keys = []
        token = None
        while True:
            kwargs = {"Bucket": self.bucket, "Prefix": prefix}
            if token:
                kwargs["ContinuationToken"] = token
            resp = self.s3.list_objects_v2(**kwargs)
            for obj in resp.get("Contents", []):
                keys.append(obj["Key"])
            if resp.get("IsTruncated"):
                token = resp.get("NextContinuationToken")
            else:
                break
        return keys

    def list_prefixes(self, prefix="", delimiter="/"):
        prefixes = []
        token = None
        while True:
            kwargs = {"Bucket": self.bucket, "Prefix": prefix, "Delimiter": delimiter}
            if token:
                kwargs["ContinuationToken"] = token
            resp = self.s3.list_objects_v2(**kwargs)
            for cp in resp.get("CommonPrefixes", []):
                prefixes.append(cp["Prefix"])
            if resp.get("IsTruncated"):
                token = resp.get("NextContinuationToken")
            else:
                break
        return prefixes


def make_r2_client():
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=f"https://{os.getenv('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com",
        aws_access_key_id=os.getenv("R2_ACCESS_KEY_ID"),
        aws_secret_access_key=os.getenv("R2_SECRET_ACCESS_KEY"),
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )


def get_store():
    if os.getenv("LOCAL_MODE") in ("1", "true", "True", "yes"):
        return LocalStore(os.getenv("LOCAL_DIR", "weather_data"))
    client = make_r2_client()
    bucket = os.getenv("R2_BUCKET_NAME")
    return R2Store(client, bucket)


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
    return insecure_get_meta(url, timeout)[0]


def insecure_get_meta(url, timeout):
    """GET returning (bytes, headers), skipping TLS verification — several
    IMD/MOSDAC endpoints serve broken certificate chains in CI. Headers matter
    because IMD's satellite JPEGs are overwritten in place; Last-Modified is
    the frame timestamp."""
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
