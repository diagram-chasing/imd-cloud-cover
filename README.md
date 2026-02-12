# IMD Meteograms Scraper

Downloads weather meteogram GIFs from India Meteorological Department (IMD) and uploads them to Cloudflare R2 storage.

## Setup

1. Install dependencies:
```bash
pip install requests boto3 python-dotenv tqdm
```

2. Create `.env` file:
```env
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_BUCKET_NAME=your_bucket_name
```

## Usage

```bash
python main.py
```

Files are organized by date: `YYYY-MM-DD/filename.gif`

## Configuration

- `LOCAL_MODE = True`: Save files locally to `weather_data/` directory
- `LOCAL_MODE = False`: Upload to Cloudflare R2 (default)