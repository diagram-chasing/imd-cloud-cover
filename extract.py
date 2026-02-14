import cv2
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from datetime import datetime, timedelta

station = 'BNG'
img_bgr = cv2.imread(f'data/2026-02-14_{station}-meteogram.jpg')
cropped = img_bgr[866:952, 70:1090]
img_rgb = cv2.cvtColor(cropped, cv2.COLOR_BGR2RGB)
h, w = img_rgb.shape[:2]

samples = 80
x_indices = np.linspace(80, w - 5, samples).astype(int)
sampled_img = img_rgb[:, x_indices, :]

# Split the vertical height into 3 equal bands (High, Middle, Low)
bands = np.array_split(sampled_img, 3, axis=0)
cloud_data = []

for band in bands:
    band_h = band.shape[0]
    # Create a boolean mask where pixels are "white" (R, G, and B > 200)
    is_white = (band > 200).all(axis=2)

    # For each column, find the first 'True' index from the top
    # argmax returns the first index of the max value (True)
    first_white_idx = np.where(is_white.any(axis=0), is_white.argmax(axis=0), band_h)

    # Calculate percentage based on height from the bottom
    percentage = ((band_h - first_white_idx) / band_h) * 100
    cloud_data.append(percentage)

# get from file name
start_date = datetime(2026, 2, 14)
times = [start_date + timedelta(hours=i*3) for i in range(samples)]

df = pd.DataFrame({
    'datetime': times,
    'high': cloud_data[0],
    'middle': cloud_data[1],
    'low': cloud_data[2]
})
df.to_csv('data/cloud_data.csv', index=False)

fig, ax = plt.subplots(figsize=(14, 4))
ax.set_facecolor('#4a7ba7')

layers = [
    (0, 66, 0.34, 'high'),
    (1, 33, 0.33, 'middle'),
    (2, 0,  0.33, 'low')
]

for idx, base_y, mult, label in layers:
    # Scale 0-100% to the specific band height in the plot
    y_values = (cloud_data[idx] * mult) + base_y

    ax.fill_between(range(samples), base_y, y_values,
                    step='post', color='white', alpha=1, lw=0)

    # Add band labels on the left
    ax.text(-2, base_y + 16.5, label, fontweight='bold', ha='right', va='center')

    # Draw divider lines between bands
    if base_y > 0:
        ax.axhline(base_y, color='white', linewidth=0.8, alpha=0.3)

# Clean up axes
ax.set_ylim(0, 100)
ax.set_xlim(0, samples - 1)
ax.set_yticks([])
ax.grid(True, alpha=0.15, color='white', axis='x')

for spine in ['top', 'right', 'left', 'bottom']:
    ax.spines[spine].set_visible(False)

tick_indices = range(0, samples, 8)
ax.set_xticks(tick_indices)
ax.set_xticklabels([times[i].strftime('%d %b').upper() for i in tick_indices], fontsize=9)

plt.tight_layout()
plt.savefig('data/recreation.png', dpi=200, bbox_inches='tight')
