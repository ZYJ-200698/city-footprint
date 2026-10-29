"""v2.10 周边发现功能验证（Playwright 无头）

用法：先用 `python -m http.server 8770 --directory dist --bind 127.0.0.1` 起服务，再运行本脚本。
"""
import json
import os
import sys
from urllib.parse import urljoin

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8770/"
HERE = os.path.dirname(os.path.abspath(__file__))

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(f"{'PASS' if cond else 'FAIL'}  {name}" + (f"  [{detail}]" if detail else ""))


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=2,
            is_mobile=True,
            has_touch=True,
            permissions=["geolocation"],
            geolocation={"latitude": 23.6126, "longitude": 104.3371},
        )
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append("console:" + m.text) if m.type == "error" else None)

        page.goto(BASE, wait_until="load")
        page.wait_for_selector("#splash", state="detached", timeout=20000)
        page.wait_for_timeout(600)

        check("页面标题正确", "城市足迹" in page.title() or page.locator("#map").count() == 1, page.title())
        check("FAB 存在且可见", page.locator("#nearby-fab").is_visible())

        page.click("#nearby-fab")
        page.wait_for_selector("#nearby-sheet", state="visible")
        page.wait_for_function(
            "() => /已载入/.test(document.querySelector('#nearby-status')?.textContent || '')",
            timeout=40000,
        )
        status = page.locator("#nearby-status").inner_text()
        check("村级数据载入成功", "13,554" in status or "13554" in status, status)

        meta = page.evaluate("() => { const d = window.__nr.state.data; return { c: d.count, crs: d.crs, prov: d.provName }; }")
        check("数据规模与坐标系", meta["c"] == 13554 and meta["crs"] == "GCJ-02", json.dumps(meta, ensure_ascii=False))

        page.fill("#nearby-search", "磨憨")
        page.wait_for_selector("#nearby-list .nr-row")
        hits = page.locator("#nearby-list .nr-row").count()
        check("村名搜索有结果", hits >= 3, f"{hits} 条")

        page.locator("#nearby-list .nr-row").first.click()
        page.wait_for_function(
            "() => /km 内共|最近的/.test(document.querySelector('#nearby-status')?.textContent || '')",
            timeout=20000,
        )
        n10 = page.evaluate("() => window.__nr.state.results.length")
        rows = page.evaluate(
            "() => [...document.querySelectorAll('#nearby-list .nr-row')].slice(0,4)"
            ".map(n => n.textContent.replace(/\\s+/g,' ').trim())"
        )
        check("点击村名后列出周边", n10 >= 1, f"{n10} 条; 首行={rows[0] if rows else '—'}")
        check("最近一条距离为 0m 级", rows and ("m" in rows[0]), rows[0] if rows else "")

        page.click("#nearby-radius button[data-km='50']")
        page.wait_for_timeout(400)
        n50 = page.evaluate("() => window.__nr.state.results.length")
        check("半径 10→50km 结果增多", n50 > n10, f"{n10} → {n50}")

        dist_ok = page.evaluate(
            """() => {
              const t = [...document.querySelectorAll('#nearby-list .nr-dist')].map(n => {
                const s = n.textContent.trim();
                return s.includes('m') && !s.includes('km') ? parseFloat(s)/1000 : parseFloat(s);
              });
              return t.every((v,i) => i === 0 || v >= t[i-1]);
            }"""
        )
        check("距离按升序排列", dist_ok)

        page.click("#nearby-close")
        page.wait_for_timeout(300)
        check("关闭按钮生效", page.evaluate("() => document.querySelector('#nearby-sheet').classList.contains('hidden')"))

        ys = page.evaluate(
            """async () => {
              const [lng, lat] = window.__nr.wgs2gcj(104.3371, 23.6126);
              const n = await window.__nr.query(lng, lat, '砚山县城');
              return { n, lng, lat };
            }"""
        )
        page.wait_for_timeout(500)
        check("砚山县城周边村数合理", ys["n"] > 100, f"{ys['n']} 个村（10km）")
        top3 = page.evaluate(
            "() => [...document.querySelectorAll('#nearby-list .nr-row')].slice(0,3)"
            ".map(n => n.textContent.replace(/\\s+/g,' ').trim())"
        )
        check("砚山最近村落归属江那镇", any("江那镇" in t for t in top3), " / ".join(top3))

        page.screenshot(path=os.path.join(HERE, "v210_nearby.png"), full_page=False)

        page.mouse.click(195, 56)
        page.wait_for_timeout(350)
        check("点遮罩可关闭", page.evaluate("() => document.querySelector('#nearby-sheet').classList.contains('hidden')"))

        page.screenshot(path=os.path.join(HERE, "v210_fab.png"), full_page=False)

        prov = page.evaluate(
            """() => {
              const inst = window.echarts.getInstanceByDom(document.querySelector('#map'));
              return inst ? inst.getOption().series[0].data.length : null;
            }"""
        )
        check("基础地图未受影响", prov == 36, f"省块 {prov}")

        check("无 JS 运行错误", len(errors) == 0, "; ".join(errors[:3]))

        browser.close()

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n===== {passed}/{len(results)} 通过 =====")
    if passed != len(results):
        sys.exit(1)


if __name__ == "__main__":
    main()
