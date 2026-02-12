import os
import re
import time
import random
import requests
import boto3
import datetime
from dotenv import load_dotenv
from botocore.config import Config
from concurrent.futures import ThreadPoolExecutor
from tqdm import tqdm

load_dotenv()

BASE_URL = "https://nwp.imd.gov.in/gfs_meteograms_mausam.php"
DOMAIN = "https://nwp.imd.gov.in"
LOCAL_MODE = False
LOCAL_DOWNLOAD_DIR = "weather_data"
R2_ACCOUNT_ID = os.getenv('R2_ACCOUNT_ID')
R2_ACCESS_KEY_ID = os.getenv('R2_ACCESS_KEY_ID')
R2_SECRET_ACCESS_KEY = os.getenv('R2_SECRET_ACCESS_KEY')
R2_BUCKET_NAME = os.getenv('R2_BUCKET_NAME')

s3_client = None
if not LOCAL_MODE:
    try:
        s3_client = boto3.client(
            service_name='s3',
            endpoint_url=f'https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com',
            aws_access_key_id=R2_ACCESS_KEY_ID,
            aws_secret_access_key=R2_SECRET_ACCESS_KEY,
            region_name='auto',
            config=Config(signature_version='s3v4')
        )
    except Exception as e:
        print(f"Client init failed: {e}")
        exit(1)

def get_gif_links(page_url):
    try:
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'}
        response = requests.get(page_url, timeout=20, headers=headers)
        response.raise_for_status()
        pattern = r"['\"](\./gfs/[a-zA-Z0-9_/-]+-meteogram\.gif)['\"]"
        matches = re.findall(pattern, response.text)
        return list(set([f"{DOMAIN}{match[1:]}" for match in matches]))

    except Exception:
        return []

def process_gif(url):
    try:
        time.sleep(random.uniform(0.5, 1.5))
        filename = url.split('/')[-1]
        today_str = datetime.date.today().isoformat()
        headers = {'User-Agent': 'Mozilla/5.0'}
        with requests.get(url, stream=True, timeout=15, headers=headers) as r:
            if r.status_code != 200:
                return False

            if LOCAL_MODE:
                date_dir = os.path.join(LOCAL_DOWNLOAD_DIR, today_str)
                os.makedirs(date_dir, exist_ok=True)
                file_path = os.path.join(date_dir, filename)
                with open(file_path, 'wb') as f:
                    for chunk in r.iter_content(chunk_size=8192):
                        f.write(chunk)
            else:
                object_name = f"{today_str}/{filename}"
                s3_client.upload_fileobj(
                    r.raw,
                    R2_BUCKET_NAME,
                    object_name,
                    ExtraArgs={'ContentType': 'image/gif'}
                )
        return True

    except Exception:
        return False

def main():
    gif_urls = get_gif_links(BASE_URL)
    if not gif_urls:
        print("No URLs found.")
        return
    print(f"Processing {len(gif_urls)} files for {datetime.date.today().isoformat()}...")
    with ThreadPoolExecutor(max_workers=3) as executor:
        results = list(tqdm(executor.map(process_gif, gif_urls), total=len(gif_urls)))
    success_count = results.count(True)
    print(f"Done. Success: {success_count} | Failed: {len(gif_urls) - success_count}")

if __name__ == "__main__":
    main()