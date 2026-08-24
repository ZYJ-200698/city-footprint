"""生成 PWA maskable 图标。

原理：原 icon-192/512 是带圆角透明角的 RGBA，Android 切圆形/异形遮罩时透明角会露白底。
maskable 要求整张不透明（透明区也要填上），且重要内容在中心 80% 安全区内。
本图标的定位针已居中且在安全区内，只需把圆角外的透明像素填成主题蓝 (#1565C0)，
合成后转 RGB 输出，Android 切圆形后呈现「蓝底 + 针」，与原设计一致。

用法：在项目根目录执行 python tools/make_maskable_icons.py
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src" / "icons"
THEME_BLUE = (21, 101, 192, 255)  # #1565C0, 与 manifest theme_color 一致

def make_maskable(src_name: str, out_name: str, size: int) -> None:
    icon = Image.open(SRC / src_name).convert("RGBA")
    icon = icon.resize((size, size), Image.LANCZOS)
    bg = Image.new("RGBA", (size, size), THEME_BLUE)
    composed = Image.alpha_composite(bg, icon)
    final = composed.convert("RGB")
    out = SRC / out_name
    final.save(out, "PNG", optimize=True)
    print(f"  -> {out.relative_to(ROOT)}  ({size}x{size}, {out.stat().st_size//1024}KB)")

if __name__ == "__main__":
    print("[make_maskable_icons]")
    make_maskable("icon-512.png", "icon-maskable-512.png", 512)
    make_maskable("icon-192.png", "icon-maskable-192.png", 192)
    print("done.")
