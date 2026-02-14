import os
import re
import time
import random
import requests
import boto3
import datetime
from io import BytesIO
from PIL import Image
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
        time.sleep(random.uniform(0.1, 0.3))
        filename = url.split('/')[-1].replace('.gif', '.jpg')
        today_str = datetime.date.today().isoformat()
        headers = {'User-Agent': 'Mozilla/5.0'}

        # Download GIF to memory
        response = requests.get(url, timeout=15, headers=headers)
        if response.status_code != 200:
            return False

        # Convert GIF to JPG in memory
        gif_data = BytesIO(response.content)
        img = Image.open(gif_data)

        # Convert to RGB (remove transparency/palette)
        if img.mode in ('RGBA', 'P', 'LA'):
            rgb_img = Image.new('RGB', img.size, (255, 255, 255))
            rgb_img.paste(img, mask=img.split()[-1] if img.mode == 'RGBA' else None)
            img = rgb_img
        elif img.mode != 'RGB':
            img = img.convert('RGB')

        # Save as JPG to memory buffer
        jpg_buffer = BytesIO()
        img.save(jpg_buffer, format='JPEG', quality=85, optimize=True)
        jpg_buffer.seek(0)

        if LOCAL_MODE:
            date_dir = os.path.join(LOCAL_DOWNLOAD_DIR, today_str)
            os.makedirs(date_dir, exist_ok=True)
            file_path = os.path.join(date_dir, filename)
            with open(file_path, 'wb') as f:
                f.write(jpg_buffer.read())
        else:
            object_name = f"{today_str}/{filename}"
            s3_client.upload_fileobj(
                jpg_buffer,
                R2_BUCKET_NAME,
                object_name,
                ExtraArgs={'ContentType': 'image/jpeg'}
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
    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(tqdm(executor.map(process_gif, gif_urls), total=len(gif_urls)))
    success_count = results.count(True)
    print(f"Done. Success: {success_count} | Failed: {len(gif_urls) - success_count}")

if __name__ == "__main__":
    main()