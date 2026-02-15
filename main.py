import os
import re
import time
import random
import requests
import boto3
import json
import datetime
from io import BytesIO
from PIL import Image
from dotenv import load_dotenv
from botocore.config import Config
from concurrent.futures import ThreadPoolExecutor
from tqdm import tqdm
from extract_data import extract_to_json_buffer
from requests.adapters import HTTPAdapter

load_dotenv()

BASE_URL = "https://nwp.imd.gov.in/gfs_meteograms_mausam.php"
DOMAIN = "https://nwp.imd.gov.in"
LOCAL_MODE = False
LOCAL_DIR = "weather_data"
R2_BUCKET = os.getenv('R2_BUCKET_NAME')

# Global Session for connection pooling (Speed improvement)
sess = requests.Session()
adapter = HTTPAdapter(pool_connections=10, pool_maxsize=10)
sess.mount('https://', adapter)
sess.headers.update({'User-Agent': 'Mozilla/5.0'})

# Pre-compile regex
LINK_PATTERN = re.compile(r"['\"](\./gfs/[a-zA-Z0-9_/-]+-meteogram\.gif)['\"]")

s3 = None
if not LOCAL_MODE:
    try:
        s3 = boto3.client(
            's3',
            endpoint_url=f"https://{os.getenv('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com",
            aws_access_key_id=os.getenv('R2_ACCESS_KEY_ID'),
            aws_secret_access_key=os.getenv('R2_SECRET_ACCESS_KEY'),
            region_name='auto',
            config=Config(signature_version='s3v4')
        )
    except Exception as e:
        exit(f"S3 Init failed: {e}")

def save_file(buffer, path, mime_type):
    """Unified handler for Local vs S3 storage."""
    buffer.seek(0)
    if LOCAL_MODE:
        full_path = os.path.join(LOCAL_DIR, path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, 'wb') as f:
            f.write(buffer.read())
    else:
        s3.upload_fileobj(buffer, R2_BUCKET, path, ExtraArgs={'ContentType': mime_type})

def get_gif_links():
    try:
        res = sess.get(BASE_URL, timeout=20)
        res.raise_for_status()
        return list(set(f"{DOMAIN}{m[1:]}" for m in LINK_PATTERN.findall(res.text)))
    except Exception:
        return []

def process_gif(url):
    try:
        time.sleep(random.uniform(0.1, 0.3))
        filename = url.split('/')[-1]
        base_name = filename.replace('-meteogram.gif', '')
        today = datetime.date.today()

        # Download
        res = sess.get(url, timeout=15)
        if res.status_code != 200: return None

        # Image Processing
        img = Image.open(BytesIO(res.content))
        if img.mode in ('RGBA', 'P', 'LA'):
            bg = Image.new('RGB', img.size, (255, 255, 255))
            bg.paste(img, mask=img.split()[-1] if img.mode == 'RGBA' else None)
            img = bg
        else:
            img = img.convert('RGB')

        if img.width > 1200:
            img.thumbnail((1200, 4000), Image.Resampling.LANCZOS)

        # Buffers
        webp_buf = BytesIO()
        img.save(webp_buf, format='WEBP', quality=80, method=6)

        json_buf = extract_to_json_buffer(img, datetime.datetime.combine(today, datetime.time(0, 0)))

        # Save/Upload
        date_str = today.isoformat()
        webp_name = filename.replace('.gif', '.webp')
        json_name = filename.replace('.gif', '.json')

        save_file(webp_buf, f"{date_str}/{webp_name}", 'image/webp')
        save_file(json_buf, f"{date_str}/{json_name}", 'application/json')

        return {
            'location': base_name,
            'date': date_str,
            'image': webp_name,
            'data': json_name
        }
    except Exception:
        return None

def main():
    urls = get_gif_links()
    if not urls: return print("No URLs found.")

    today_str = datetime.date.today().isoformat()
    print(f"Processing {len(urls)} files for {today_str}...")

    with ThreadPoolExecutor(max_workers=8) as ex:
        results = list(tqdm(ex.map(process_gif, urls), total=len(urls)))

    success = [r for r in results if r]
    print(f"Done. Success: {len(success)} | Failed: {len(urls) - len(success)}")

if __name__ == "__main__":
    main()