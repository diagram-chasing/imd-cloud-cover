"""Extract cloud cover data from meteogram images in memory."""
import numpy as np
import cv2
from datetime import datetime, timedelta
from PIL import Image
from io import BytesIO


def extract_cloud_data(pil_image, start_date):
    """
    Extract cloud cover data from a meteogram image.

    Args:
        pil_image: PIL Image object
        start_date: datetime object for the forecast start date

    Returns:
        dict with structure:
        {
            "start_date": "2026-02-15",
            "samples": 80,
            "data": [
                {
                    "datetime": "2026-02-15T00:00:00",
                    "high": 45.2,
                    "middle": 23.1,
                    "low": 67.8
                },
                ...
            ]
        }
    """
    # Convert PIL to OpenCV format
    img_array = np.array(pil_image.convert('RGB'))
    img_bgr = cv2.cvtColor(img_array, cv2.COLOR_RGB2BGR)

    # Crop to cloud cover section (same coordinates as extract.py)
    cropped = img_bgr[866:952, 70:1090]
    h, w = cropped.shape[:2]

    # Sample 80 points across the width
    samples = 80
    x_indices = np.linspace(80, w - 5, samples).astype(int)
    sampled_img = cropped[:, x_indices, :]

    # Split into 3 bands (high, middle, low clouds)
    bands = np.array_split(sampled_img, 3, axis=0)
    cloud_data = []

    for band in bands:
        band_h = band.shape[0]
        is_white = (band > 200).all(axis=2)

        has_white = is_white.any(axis=0)
        first_white_idx = np.where(has_white, is_white.argmax(axis=0), band_h)

        percentage = ((band_h - first_white_idx) / band_h) * 100
        cloud_data.append(percentage.tolist())

    # Generate timestamps (3-hour intervals)
    times = [start_date + timedelta(hours=i*3) for i in range(samples)]

    # Build output structure
    result = {
        "start_date": start_date.isoformat(),
        "samples": samples,
        "data": []
    }

    for i in range(samples):
        result["data"].append({
            "datetime": times[i].isoformat(),
            "high": round(cloud_data[0][i], 2),
            "middle": round(cloud_data[1][i], 2),
            "low": round(cloud_data[2][i], 2)
        })

    return result


def extract_to_json_buffer(pil_image, start_date):
    """
    Extract cloud data and return as JSON buffer.

    Args:
        pil_image: PIL Image object
        start_date: datetime object

    Returns:
        BytesIO buffer containing JSON data
    """
    import json

    data = extract_cloud_data(pil_image, start_date)
    json_str = json.dumps(data, indent=2)

    buffer = BytesIO()
    buffer.write(json_str.encode('utf-8'))
    buffer.seek(0)

    return buffer
