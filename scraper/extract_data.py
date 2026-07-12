"""Extract cloud cover data from meteogram images in memory."""
import numpy as np
import cv2
from datetime import timedelta
from io import BytesIO

# Crop of the cloud-cover panel within the (thumbnailed, width==1200) meteogram.
CROP_Y0, CROP_Y1 = 866, 952
CROP_X0, CROP_X1 = 70, 1090
EXPECTED_WIDTH = 1100


class ExtractionError(Exception):
    """Raised when an image fails validation before/after extraction."""

    def __init__(self, stage, reason):
        self.stage = stage
        self.reason = reason
        super().__init__(f"{stage}: {reason}")


def validate_crop(pil_image):
    """Ensure the image geometry matches what the fixed crop expects.

    IMD occasionally changes chart geometry; this turns silent corruption into a
    reported failure. Checks post-thumbnail width and that the cloud panel crop
    actually contains the panel's blue background near its edges.
    """
    if pil_image.width != EXPECTED_WIDTH:
        raise ExtractionError("validate_crop", f"width {pil_image.width} != {EXPECTED_WIDTH}")
    if pil_image.height < CROP_Y1:
        raise ExtractionError("validate_crop", f"height {pil_image.height} < {CROP_Y1}")

    arr = np.array(pil_image.convert("RGB"))
    crop = arr[CROP_Y0:CROP_Y1, CROP_X0:CROP_X1]
    # The panel background is a saturated blue; sample the bottom rows where cover
    # is usually 0 (open sky) and confirm blue dominates there at least somewhere.
    bottom = crop[-6:, :, :]
    b, g, r = bottom[:, :, 2], bottom[:, :, 1], bottom[:, :, 0]
    bluish = (b.astype(int) > r.astype(int) + 20) & (b.astype(int) > 80)
    if bluish.mean() < 0.15:
        raise ExtractionError("validate_crop", f"blue panel not detected (bluish={bluish.mean():.2f})")


def validate_values(cloud_data):
    """Range/degenerate checks on extracted percentages. Returns list of warnings."""
    warnings = []
    for band_name, values in zip(("high", "middle", "low"), cloud_data):
        arr = np.asarray(values)
        if arr.size == 0:
            warnings.append(f"{band_name}: empty")
            continue
        if (arr < 0).any() or (arr > 100).any():
            warnings.append(f"{band_name}: out-of-range values")
        if np.all(arr == 0):
            warnings.append(f"{band_name}: all-zero")
        if np.all(arr >= 99.9):
            warnings.append(f"{band_name}: all-full")
    return warnings


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

    # Crop to cloud cover section
    cropped = img_bgr[CROP_Y0:CROP_Y1, CROP_X0:CROP_X1]
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


def extract_to_json_buffer(pil_image, start_date, validate=True):
    """
    Extract cloud data and return (buffer, warnings).

    Args:
        pil_image: PIL Image object
        start_date: datetime object
        validate: run geometry + value validators (raises ExtractionError on
            geometry failure; value issues are returned as warnings)

    Returns:
        (BytesIO buffer containing JSON data, list[str] warnings)
    """
    import json

    if validate:
        validate_crop(pil_image)

    data = extract_cloud_data(pil_image, start_date)

    warnings = []
    if validate:
        bands = [
            [d["high"] for d in data["data"]],
            [d["middle"] for d in data["data"]],
            [d["low"] for d in data["data"]],
        ]
        warnings = validate_values(bands)

    json_str = json.dumps(data, indent=2)
    buffer = BytesIO()
    buffer.write(json_str.encode('utf-8'))
    buffer.seek(0)

    return buffer, warnings
