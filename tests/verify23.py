"""v2.9 验证：maskable 图标 + 平台自适应安装引导 + 版本号。"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
DIST = ROOT / "dist"

def read(p: Path) -> str:
    return p.read_text(encoding="utf-8")

def ok(name: str, cond: bool, detail: str = "") -> bool:
    print(f"  [{'OK' if cond else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))
    return cond

def main() -> int:
    print("[verify23 v2.9]")
    fails = 0
    passed = 0

    # 1) maskable 图标文件
    for sz in (192, 512):
        p = SRC / "icons" / f"icon-maskable-{sz}.png"
        d = DIST / "icons" / f"icon-maskable-{sz}.png"
        if ok(f"src/icons/icon-maskable-{sz}.png 存在", p.exists()): passed += 1
        else: fails += 1
        if ok(f"dist/icons/icon-maskable-{sz}.png 存在", d.exists()): passed += 1
        else: fails += 1

    # 2) manifest 含 4 个 icons 条目，其中 2 个 purpose 包含 maskable
    mf = read(SRC / "manifest.webmanifest")
    data = json.loads(mf)
    icons = data.get("icons", [])
    purposes = [i.get("purpose", "") for i in icons]
    any_only = [p for p in purposes if p == "any"]
    maskable = [p for p in purposes if "maskable" in p]
    if ok("manifest icons 数组 4 项", len(icons) == 4, f"实际 {len(icons)}"): passed += 1
    else: fails += 1
    if ok("2 项 purpose=any", len(any_only) == 2): passed += 1
    else: fails += 1
    if ok("2 项 purpose=any maskable", len(maskable) == 2): passed += 1
    else: fails += 1
    sizes = sorted([i["sizes"] for i in icons])
    if ok("icons 尺寸覆盖 192/512", sizes == ["192x192", "192x192", "512x512", "512x512"], str(sizes)): passed += 1
    else: fails += 1

    # 3) index.html 安装引导：3 段 data-os，默认 iOS 显式、其余 hidden
    html = read(SRC / "index.html")
    if ok("index.html 包含 #install-guide", 'id="install-guide"' in html): passed += 1
    else: fails += 1
    for os in ("ios", "android", "other"):
        if ok(f"index.html 含 data-os=\"{os}\" 段落", f'data-os="{os}"' in html): passed += 1
        else: fails += 1
    # android/other 初始 hidden
    m_android = re.search(r'<p class="me-desc" data-os="android"([^>]*)>([^<]*)', html)
    m_other = re.search(r'<p class="me-desc" data-os="other"([^>]*)>([^<]*)', html)
    if ok("android 段初始 hidden", m_android and "hidden" in m_android.group(1), m_android.group(1) if m_android else "no match"): passed += 1
    else: fails += 1
    if ok("other 段初始 hidden", m_other and "hidden" in m_other.group(1)): passed += 1
    else: fails += 1

    # 4) app.js 含 applyInstallGuide，UA 检测三平台
    js = read(SRC / "app.js")
    if ok("app.js 含 applyInstallGuide 函数", "function applyInstallGuide" in js): passed += 1
    else: fails += 1
    if ok("applyInstallGuide 检测 iOS", re.search(r"isIOS\s*=.*iphone|ipad|ipod", js) is not None): passed += 1
    else: fails += 1
    if ok("applyInstallGuide 检测 android", "/android/.test(ua)" in js): passed += 1
    else: fails += 1
    if ok("applyInstallGuide 处理 'other' 分支", "'other'" in js): passed += 1
    else: fails += 1
    if ok("applyInstallGuide 在 boot() 被调用", "applyInstallGuide();" in js): passed += 1
    else: fails += 1
    if ok("app.js 通过 el.hidden 控制显隐", re.search(r"el\.hidden\s*=\s*el\.dataset\.os\s*!==\s*target", js) is not None): passed += 1
    else: fails += 1

    # 5) sw.js 版本号 + 缓存列表含 maskable
    sw = read(SRC / "sw.js")
    if ok("sw.js CACHE = fp-v21", re.search(r"const CACHE\s*=\s*['\"]fp-v21['\"]", sw) is not None): passed += 1
    else: fails += 1
    if ok("sw.js CORE 含 icon-maskable-192", "icon-maskable-192.png" in sw): passed += 1
    else: fails += 1
    if ok("sw.js CORE 含 icon-maskable-512", "icon-maskable-512.png" in sw): passed += 1
    else: fails += 1

    # 6) 版本号
    if ok("index.html 版本号 v2.9", "v2.9" in html): passed += 1
    else: fails += 1

    # 7) dist 与 src 关键文件一致
    pairs = [
        ("index.html", SRC / "index.html", DIST / "index.html"),
        ("manifest.webmanifest", SRC / "manifest.webmanifest", DIST / "manifest.webmanifest"),
        ("sw.js", SRC / "sw.js", DIST / "sw.js"),
        ("app.js", SRC / "app.js", DIST / "app.js"),
    ]
    for name, a, b in pairs:
        same = a.exists() and b.exists() and a.read_bytes() == b.read_bytes()
        if ok(f"dist/{name} == src/{name}", same): passed += 1
        else: fails += 1

    print(f"\nResult: {passed} passed, {fails} failed")
    return 0 if fails == 0 else 1

if __name__ == "__main__":
    sys.exit(main())
