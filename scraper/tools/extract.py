import cv2
import numpy as np
import csv
import re
from datetime import datetime, timedelta
from pathlib import Path

input_path = 'data/2026-02-14_BNG-meteogram.jpg'

filename = Path(input_path).name
match = re.match(r'(\d{4})-(\d{2})-(\d{2})_', filename)
if not match:
    raise ValueError(f"Could not extract date from filename: {filename}")
start_dt = datetime(int(match.group(1)), int(match.group(2)), int(match.group(3)))

csv_path = 'data/cloud_data.csv'
plot_path = 'data/recreation_wallpaper.png'

img_bgr = cv2.imread(input_path)
cropped = img_bgr[866:952, 70:1090]
h, w = cropped.shape[:2]

samples = 80
x_indices = np.linspace(80, w - 5, samples).astype(int)
sampled_img = cropped[:, x_indices, :]

bands = np.array_split(sampled_img, 3, axis=0)
cloud_data = []

for band in bands:
    band_h = band.shape[0]
    is_white = (band > 200).all(axis=2)

    has_white = is_white.any(axis=0)
    first_white_idx = np.where(has_white, is_white.argmax(axis=0), band_h)

    percentage = ((band_h - first_white_idx) / band_h) * 100
    cloud_data.append(percentage)

times = [start_dt + timedelta(hours=i*3) for i in range(samples)]

with open(csv_path, 'w', newline='') as f:
    writer = csv.writer(f)
    writer.writerow(['datetime', 'high', 'middle', 'low'])
    rows = zip(times, cloud_data[0], cloud_data[1], cloud_data[2])
    writer.writerows(rows)

H_PLOT, W_PLOT = 1080, 1920
canvas = np.full((H_PLOT, W_PLOT, 3), (167, 123, 74), dtype=np.uint8)

step_w = W_PLOT / samples
layers = [
    (0, 66, 0.34, 'HIGH'),
    (1, 33, 0.33, 'MIDDLE'),
    (2, 0,  0.33, 'LOW')
]

for y_pct in [33, 66]:
    y_px = int(H_PLOT - (y_pct / 100 * H_PLOT))
    cv2.line(canvas, (0, y_px), (W_PLOT, y_px), (255, 255, 255), 1)

for idx, base_y_pct, mult, label in layers:
    data = cloud_data[idx]

    for i in range(samples):
        val = (data[i] * mult) + base_y_pct

        y_bottom = int(H_PLOT - (base_y_pct / 100 * H_PLOT))
        y_top = int(H_PLOT - (val / 100 * H_PLOT))

        x_start = int(i * step_w)
        x_end = int((i + 1) * step_w)

        if y_top < y_bottom:
            cv2.rectangle(canvas, (x_start, y_top), (x_end, y_bottom), (255, 255, 255), -1)

tick_indices = range(0, samples, 8)
for i in tick_indices:
    x_pos = int(i * step_w)
    date_str = times[i].strftime('%d %b').upper()
    cv2.putText(canvas, date_str, (x_pos + 5, H_PLOT - 10), cv2.FONT_HERSHEY_SIMPLEX,
                0.4, (255, 255, 255), 1, cv2.LINE_AA)

cv2.imwrite(plot_path, canvas)