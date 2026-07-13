import re
import time
import random
import json
import argparse
import datetime
from io import BytesIO

import requests
from PIL import Image
from dotenv import load_dotenv
from concurrent.futures import ThreadPoolExecutor
from tqdm import tqdm
from requests.adapters import HTTPAdapter

from extract_data import extract_to_json_buffer, ExtractionError
from storage import get_store

load_dotenv()

BASE_URL = "https://nwp.imd.gov.in/gfs_meteograms_mausam.php"
DOMAIN = "https://nwp.imd.gov.in"

sess = requests.Session()
adapter = HTTPAdapter(pool_connections=10, pool_maxsize=10)
sess.mount("https://", adapter)
sess.headers.update({"User-Agent": "Mozilla/5.0"})

# Match both gfs_meteograms and gfs_meteograms_dist paths, any case.
LINK_PATTERN = re.compile(r"['\"]\.?/(gfs/[a-zA-Z0-9_/-]+-meteogram\.gif)['\"]")

store = get_store()


def get_gif_links():
    try:
        res = sess.get(BASE_URL, timeout=20)
        res.raise_for_status()
        return sorted(set(f"{DOMAIN}/{m}" for m in LINK_PATTERN.findall(res.text)))
    except Exception:
        return []


def code_from_url(url):
    filename = url.split("/")[-1]
    return filename.replace("-meteogram.gif", "")


def process_gif(url, date):
    """download, extract, and store one station. errors return {code, stage, reason}."""
    code = code_from_url(url)
    try:
        time.sleep(random.uniform(0.1, 0.3))

        res = sess.get(url, timeout=15)
        if res.status_code != 200:
            return {"code": code, "stage": "download", "reason": f"http {res.status_code}"}

        img = Image.open(BytesIO(res.content))
        if img.mode in ("RGBA", "P", "LA"):
            bg = Image.new("RGB", img.size, (255, 255, 255))
            bg.paste(img, mask=img.split()[-1] if img.mode == "RGBA" else None)
            img = bg
        else:
            img = img.convert("RGB")

        if img.width > 1200:
            img.thumbnail((1200, 4000), Image.Resampling.LANCZOS)

        start = datetime.datetime.combine(
            datetime.date.fromisoformat(date), datetime.time(0, 0)
        )
        try:
            json_buf, warnings = extract_to_json_buffer(img, start)
        except ExtractionError as e:
            return {"code": code, "stage": e.stage, "reason": e.reason}

        webp_buf = BytesIO()
        img.save(webp_buf, format="WEBP", quality=80, method=6)

        store.put_fileobj(webp_buf, f"{date}/{code}-meteogram.webp", "image/webp")
        store.put_fileobj(json_buf, f"{date}/{code}-meteogram.json", "application/json")

        result = {"code": code, "ok": True}
        if warnings:
            result["warnings"] = warnings
        return result
    except Exception as e:  # noqa: BLE001 — capture reason, don't swallow
        return {"code": code, "stage": "process", "reason": str(e)[:200]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", help="write run-results JSON here (for aggregate.py)")
    ap.add_argument("--date", help="snapshot date (YYYY-MM-DD); default today")
    ap.add_argument("--limit", type=int, help="only process the first N stations (debug)")
    args = ap.parse_args()

    date = args.date or datetime.date.today().isoformat()
    urls = get_gif_links()
    if not urls:
        print("No URLs found.")
        if args.out:
            with open(args.out, "w") as f:
                json.dump({"date": date, "succeeded": [], "failed": [],
                          "suspicious": [], "discovered": 0}, f)
        return

    if args.limit:
        urls = urls[: args.limit]

    print(f"Processing {len(urls)} files for {date}...")

    results = []
    with ThreadPoolExecutor(max_workers=8) as ex:
        for r in tqdm(ex.map(lambda u: process_gif(u, date), urls), total=len(urls)):
            results.append(r)

    succeeded = [r["code"] for r in results if r.get("ok")]
    failed = [{"code": r["code"], "stage": r["stage"], "reason": r["reason"]}
              for r in results if not r.get("ok")]
    suspicious = [{"code": r["code"], "warnings": r["warnings"]}
                  for r in results if r.get("ok") and r.get("warnings")]

    n = len(urls)
    rate = len(succeeded) / n if n else 0
    print(f"Done. Success: {len(succeeded)} | Failed: {len(failed)} | "
          f"Suspicious: {len(suspicious)} | Rate: {rate:.0%}")

    report = {
        "date": date,
        "discovered": n,
        "succeeded": sorted(succeeded),
        "failed": failed,
        "failed_count": len(failed),
        "suspicious": suspicious,
        "success_rate": round(rate, 4),
    }
    if args.out:
        with open(args.out, "w") as f:
            json.dump(report, f, indent=2)
        print(f"Wrote run-results to {args.out}")

    # Signal CI failure if extraction success dropped below 80%.
    if n and rate < 0.80:
        raise SystemExit(f"Success rate {rate:.0%} below 80% threshold")


if __name__ == "__main__":
    main()
