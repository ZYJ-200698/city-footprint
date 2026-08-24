# -*- coding: utf-8 -*-
"""生成 PWA 图标：定位图钉 + 渐变圆角方形底"""
from PIL import Image, ImageDraw
import os

OUT = r'C:\Users\ZYJ\Documents\Agent 开发\workspace-013\city-footprint\src\icons'
os.makedirs(OUT, exist_ok=True)

def lerp(c1, c2, t):
    return tuple(int(a + (b - a) * t) for a, b in zip(c1, c2))

def rounded_mask(size, radius):
    m = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m

def make_icon(size, path, rounded=True):
    S = size * 4  # 4x 超采样抗锯齿
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # 渐变底（蓝->青）
    top, bottom = (21, 101, 192), (0, 172, 193)
    for y in range(S):
        d.line([(0, y), (S, y)], fill=lerp(top, bottom, y / S) + (255,))
    if rounded:
        mask = rounded_mask(S, int(S * 0.22))
        img.putalpha(mask)
        d = ImageDraw.Draw(img)
    # 定位图钉（白色）：先画三角再叠整圆，避免接缝
    cx, cy = S * 0.5, S * 0.44
    r = S * 0.26          # 钉头半径
    tip_y = S * 0.82      # 钉尖
    d.polygon([(cx - r * 0.866, cy + r * 0.5), (cx + r * 0.866, cy + r * 0.5), (cx, tip_y)],
              fill=(255, 255, 255, 255))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255, 255))
    # 钉心圆点（橙色）
    ir = S * 0.115
    d.ellipse([cx - ir, cy - ir, cx + ir, cy + ir], fill=(255, 138, 61, 255))
    img = img.resize((size, size), Image.LANCZOS)
    img.save(path)
    print(f'  -> {os.path.basename(path)} {size}x{size}')

make_icon(192, os.path.join(OUT, 'icon-192.png'))
make_icon(512, os.path.join(OUT, 'icon-512.png'))
make_icon(180, os.path.join(OUT, 'apple-touch-icon.png'), rounded=False)  # iOS 自动加圆角，底图需满版
make_icon(32, os.path.join(OUT, 'favicon-32.png'))
