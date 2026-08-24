# 从生成的"云+蓝天"图中抠云：只把"与边缘相连的蓝天"抠掉（洪水填充/连通域），云体内部阴影保留
from PIL import Image
import numpy as np
from scipy import ndimage
import os

SRC = r"C:\Users\ZYJ\Documents\Agent 开发\workspace-013\city-footprint\src\assets\fx\A_single_tall_fluffy_cumulus_c_2026-08-22T11-09-06.png"
OUTDIR = r"C:\Users\ZYJ\Documents\Agent 开发\workspace-013\city-footprint\src\assets\fx"

im = Image.open(SRC).convert("RGB")
# 裁掉顶部纯蓝天与底部水印（保留云塔主体；y<=1060 已无水印）
crop = im.crop((60, 80, 780, 1060))   # 720 x 980
arr = np.asarray(crop).astype(np.int16)
r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
H, W = r.shape

# 1) 蓝天窗：b 明显高于 r 视为“像蓝天”
skyish = (b - r) > 38

# 2) 连通域：只保留与图片边缘相连的蓝天块（=真正的背景天），云体内部的蓝灰阴影不碰
lab, n = ndimage.label(skyish)
border_labels = set(np.unique(np.concatenate([
    lab[0, :], lab[-1, :], lab[:, 0], lab[:, -1]
])).tolist()) - {0}
bg_sky = np.isin(lab, list(border_labels)) if border_labels else np.zeros_like(skyish)

# 3) alpha：背景天=0，其余=255；再高斯羽化边缘得到柔和过渡（云体内部阴影保持实体，不掏空）
alpha = np.where(bg_sky, 0, 255).astype(np.float32)
alpha = ndimage.gaussian_filter(alpha, sigma=2.0)
alpha = np.clip(alpha, 0, 255).astype(np.uint8)

rgba = np.dstack([arr[..., 0], arr[..., 1], arr[..., 2], alpha]).astype(np.uint8)
out = Image.fromarray(rgba, "RGBA")

# 5) 自动裁到非透明包围盒
bbox = out.getbbox()
if bbox:
    out = out.crop(bbox)
print("tight sprite size:", out.size)

left = out                                   # 金边朝右（朝中央）
right = out.transpose(Image.FLIP_LEFT_RIGHT)  # 金边朝左（朝中央）
left.save(os.path.join(OUTDIR, "cloud_l.png"))
right.save(os.path.join(OUTDIR, "cloud_r.png"))

# 6) 预览：合成到中性灰底（便于发现残留蓝天），以及一张“左右云闭合”效果
tw, th = out.size
chk = Image.new("RGBA", (tw, th), (200, 60, 120, 255))  # 品红底，残留蓝天会很显眼
chk.alpha_composite(out)
chk.convert("RGB").save(os.path.join(OUTDIR, "_preview_keyed.png"))

# 闭合预览：780x900 示意屏，假地图网格底 + 左右云重叠闭合
PW, PH = 780, 900
scene = Image.new("RGBA", (PW, PH), (185, 202, 216, 255))
from PIL import ImageDraw
d = ImageDraw.Draw(scene)
for i in range(0, PW, 90):
    d.line([(i, 0), (i, PH)], fill=(150, 170, 185, 255), width=2)
for j in range(0, PH, 90):
    d.line([(0, j), (PW, j)], fill=(150, 170, 185, 255), width=2)

def cover_resize(sprite, tw_, th_):
    sw, sh = sprite.size
    s = max(tw_ / sw, th_ / sh)
    ns = sprite.resize((int(sw * s) + 1, int(sh * s) + 1))
    return ns

# 左云：覆盖左 66% 宽、全高，金边(右)朝中央；右云镜像
for side, sp in (("L", left), ("R", right)):
    w = int(PW * 0.66); h = PH
    cs = cover_resize(sp, w, h)
    # cover 后裁到 w x h：左云取右侧（金边），右云取左侧（金边）
    if side == "L":
        cs = cs.crop((cs.width - w, 0, cs.width, h))
        scene.alpha_composite(cs, (int(-PW * 0.05), 0))
    else:
        cs = cs.crop((0, 0, w, h))
        scene.alpha_composite(cs, (int(PW - w + PW * 0.05), 0))
scene.convert("RGB").save(os.path.join(OUTDIR, "_preview_closed.png"))
print("saved cloud_l.png cloud_r.png _preview_keyed.png _preview_closed.png")
