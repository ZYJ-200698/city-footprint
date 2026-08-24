"""v2.9 Playwright 烟雾测试：跨平台 UA + maskable 图标可达。"""
import sys
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8766/index.html"
SHOTS = Path(__file__).resolve().parent

CASES = [
    {
        "name": "iPhone-Safari",
        "ua": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "expect_visible": "ios",
    },
    {
        "name": "Android-Chrome",
        "ua": "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36",
        "expect_visible": "android",
    },
    {
        "name": "Desktop-Chrome",
        "ua": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
        "expect_visible": "other",
    },
]

def main() -> int:
    print("[smoke23 v2.9]")
    fails = 0
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for c in CASES:
            ctx = browser.new_context(
                user_agent=c["ua"],
                viewport={"width": 390, "height": 844} if "Phone" in c["name"] or "Android" in c["name"] else {"width": 1280, "height": 800},
                is_mobile=("Phone" in c["name"] or "Android" in c["name"]),
                has_touch=("Phone" in c["name"] or "Android" in c["name"]),
            )
            page = ctx.new_page()
            page.goto(URL, wait_until="domcontentloaded", timeout=20000)
            page.wait_for_timeout(500)
            # 切到「我的」tab
            page.click("button[data-tab='me']")
            page.wait_for_timeout(400)
            visible = page.evaluate("""() => {
                const out = {};
                document.querySelectorAll('#install-guide [data-os]').forEach(el => {
                    out[el.dataset.os] = !el.hidden;
                });
                return out;
            }""")
            for os in ("ios", "android", "other"):
                expect = (os == c["expect_visible"])
                actual = visible.get(os, False)
                tag = "OK" if expect == actual else "FAIL"
                print(f"  [{tag}] {c['name']}: data-os={os} visible={actual} (expect {expect})")
                if expect != actual:
                    fails += 1
            # 截屏
            shot = SHOTS / f"smoke23_{c['name'].lower()}.png"
            page.screenshot(path=str(shot), full_page=False)
            ctx.close()
        # 验证 maskable 图标可达
        ctx = browser.new_context()
        page = ctx.new_page()
        for sz in (192, 512):
            resp = page.request.get(f"http://127.0.0.1:8766/icons/icon-maskable-{sz}.png")
            ok = resp.status == 200 and resp.headers.get("content-type", "").startswith("image/png")
            tag = "OK" if ok else "FAIL"
            print(f"  [{tag}] maskable icon {sz}px HTTP {resp.status} {resp.headers.get('content-type')}")
            if not ok:
                fails += 1
        # 验证 manifest 含 maskable
        resp = page.request.get("http://127.0.0.1:8766/manifest.webmanifest")
        mf = resp.json()
        has_maskable = any("maskable" in i.get("purpose", "") for i in mf.get("icons", []))
        tag = "OK" if has_maskable else "FAIL"
        print(f"  [{tag}] manifest 含 maskable 条目 ({len([i for i in mf.get('icons', []) if 'maskable' in i.get('purpose','')])} 项)")
        if not has_maskable:
            fails += 1
        browser.close()
    print(f"\nResult: {fails} failed")
    return 0 if fails == 0 else 1

if __name__ == "__main__":
    sys.exit(main())
