"""Storage abstraction for the meteogram pipeline.

Two backends behind one interface:
  * R2Store   — Cloudflare R2 via boto3 (production)
  * LocalStore — a directory on disk (LOCAL_MODE=1, for dev / tests)

Pick one with get_store(). Everything the scraper and aggregator write goes
through here so the two paths never drift.
"""

import json
import os
from io import BytesIO

# Cache-Control policy by key prefix (C4). Dated snapshots never change;
# rolling/latest views change daily and are served with a short TTL.
IMMUTABLE = "public, max-age=31536000, immutable"
SHORT = "public, max-age=300"


def cache_control_for(key: str) -> str:
    head = key.split("/", 1)[0]
    if head in ("latest", "meta", "rollups", "summary", "reports"):
        return SHORT
    # Dated snapshots: "2026-07-06/BNG-meteogram.json"
    return IMMUTABLE


class Store:
    """Abstract byte store keyed by path-like strings."""

    def get_bytes(self, key):
        raise NotImplementedError

    def put_bytes(self, key, data, content_type, cache_control=None):
        raise NotImplementedError

    def list_keys(self, prefix):
        raise NotImplementedError

    def exists(self, key):
        return self.get_bytes(key) is not None

    # --- JSON convenience helpers ---
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
        base = self._path(prefix)
        out = []
        # prefix may be a partial path; walk from root and filter.
        search_root = self.root
        for dirpath, _dirs, files in os.walk(search_root):
            for name in files:
                full = os.path.join(dirpath, name)
                rel = os.path.relpath(full, self.root).replace(os.sep, "/")
                if rel.startswith(prefix):
                    out.append(rel)
        return sorted(out)

    def exists(self, key):
        return os.path.exists(self._path(key))


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

    def exists(self, key):
        from botocore.exceptions import ClientError

        try:
            self.s3.head_object(Bucket=self.bucket, Key=key)
            return True
        except ClientError:
            return False


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
    """LocalStore when LOCAL_MODE is truthy, else R2Store from env creds."""
    if os.getenv("LOCAL_MODE") in ("1", "true", "True", "yes"):
        return LocalStore(os.getenv("LOCAL_DIR", "weather_data"))
    client = make_r2_client()
    bucket = os.getenv("R2_BUCKET_NAME")
    return R2Store(client, bucket)
