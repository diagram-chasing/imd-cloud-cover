# IMD Meteogram Scraper

Python scraper that downloads and processes weather meteograms from India Meteorological Department.

## Setup

```bash
pip install -r requirements.txt
cp .env.example .env  # Add your R2 credentials
```

## Environment Variables

```
R2_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
R2_BUCKET_NAME=your-bucket-name
```

## Run

```bash
python main.py
```

## Output

Uploads to R2 bucket:
- `YYYY-MM-DD/{location}-meteogram.webp` - Weather chart images (~80-120KB)
- `YYYY-MM-DD/{location}-meteogram.json` - Extracted cloud cover data

## Data Format

Each JSON file contains 80 samples (10 days, 3-hour intervals):
```json
{
  "start_date": "2026-02-15T00:00:00",
  "samples": 80,
  "data": [
    {
      "datetime": "2026-02-15T00:00:00",
      "high": 45.23,
      "middle": 23.45,
      "low": 67.89
    }
  ]
}
```
