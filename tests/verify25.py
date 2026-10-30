"""v2.11 周边发现·全国多省验证（Playwright 无头）

用法：先起本地服务 `python -m http.server 8770 --directory dist --bind 127.0.0.1`，再运行。
"""
import json
import os
import sys
import urllib.request

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8770/"
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.abspath(os.path.join(HERE, ".."))

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(f"{'PASS' if cond else 'FAIL'}  {name}" + (f"  [{detail}]" if detail else ""))


def local_index():
    path = os.path.join(PROJECT, "src", "assets", "data", "village", "index.json")
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def main():
    idx = local_index()
    print(f"本地 index.json：{len(idx['provinces'])} 省 / {idx['count']} 点")
    codes = {p["code"] for p in idx["provinces"]}
    print("可用省份代码：", sorted(codes))

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
        page.wait_for_timeout(500)

        check("FAB 可见", page.locator("#nearby-fab").is_visible())

        page.click("#nearby-fab")
        page.wait_for_selector("#nearby-sheet", state="visible")
        page.wait_for_function(
            "() => /收录/.test(document.querySelector('#nearby-status')?.textContent || '')",
            timeout=30000,
        )
        status = page.locator("#nearby-status").inner_text()
        check("显示全国收录规模", "收录" in status and "省" in status, status)

        # 1) 云南砚山：单省内查询（10km 约 15 个村，50km 约 268 个）
        r1 = page.evaluate(
            """async () => {
              const [lng, lat] = window.__nr.wgs2gcj(104.3371, 23.6126);
              const n10 = await window.__nr.query(lng, lat, '砚山县城');
              return { n10, provs: window.__nr.state.loadedProvs };
            }"""
        )
        check("云南砚山 10km 内村数合理", r1["n10"] >= 10, f"{r1['n10']} 个村, 已加载 {r1['provs']}")

        page.click("#nearby-radius button[data-km='50']")
        page.wait_for_timeout(700)
        n50 = page.evaluate("() => window.__nr.state.results.length")
        check("砚山 50km 内村数合理", n50 >= 200, f"{n50} 个村")
        page.click("#nearby-radius button[data-km='10']")
        page.wait_for_timeout(500)

        # 2) 云南磨憨：跨村镇搜索
        page.fill("#nearby-search", "磨憨")
        page.wait_for_selector("#nearby-list .nr-row", timeout=30000)
        hits = page.locator("#nearby-list .nr-row").count()
        check("村名搜索有结果", hits >= 3, f"{hits} 条")

        # 3) 跨省验证：按 index 中存在的其他省份各查一次
        test_points = {
            "11": ("北京", 116.3975, 39.9087),
            "12": ("天津", 117.2010, 39.0842),
            "31": ("上海", 121.4737, 31.2304),
            "32": ("南京", 118.7969, 32.0603),
            "50": ("重庆", 106.5516, 29.5630),
            "64": ("银川", 106.2309, 38.4872),
            "81": ("香港", 114.1694, 22.3193),
            "82": ("澳门", 113.5439, 22.1987),
            "63": ("西宁", 101.7782, 36.6171),
            "54": ("拉萨", 91.1409, 29.6456),
            "46": ("海口", 110.1999, 20.0444),
        }
        for code, (label, lng, lat) in test_points.items():
            if code not in codes:
                continue
            res = page.evaluate(
                """async ([lng, lat, label]) => {
                  const n = await window.__nr.query(lng, lat, label);
                  const row = document.querySelector('#nearby-list .nr-row');
                  return { n, first: row ? row.textContent.replace(/\\s+/g,' ').trim() : null };
                }""",
                [lng, lat, label],
            )
            check(f"{label}（{code}）周边有村落", res["n"] > 0, f"{res['n']} 个 · 首行={res['first']}")

        page.evaluate("() => window.__nr.query(104.33935, 23.61004, '砚山县城')")
        page.wait_for_timeout(600)
        page.screenshot(path=os.path.join(HERE, "v211_nearby.png"))

        # 4) 逐省遍历：每省取自身一个点位作为查询点，要求 50km 内至少 1 个村
        prov_files = [p for p in sorted(os.listdir(os.path.join(PROJECT, "src", "assets", "data", "village")))
                      if p.endswith(".json") and p != "index.json"]
        bad = []
        for fn in prov_files:
            with open(os.path.join(PROJECT, "src", "assets", "data", "village", fn), encoding="utf-8") as fh:
                d = json.load(fh)
            pts = d["points"]
            if not pts:
                bad.append(f"{d['provName']}:空")
                continue
            lng, lat = pts[len(pts) // 2][3], pts[len(pts) // 2][4]
            n = page.evaluate(
                """async ([lng, lat, label]) => {
                  const st = window.__nr.state;
                  st.radius = 50;
                  return await window.__nr.query(lng, lat, label);
                }""",
                [lng, lat, d["provName"]],
            )
            if n < 1:
                bad.append(f"{d['provName']}:0")
        check(f"逐省遍历 {len(prov_files)} 省均有村落返回", not bad, "失败：" + ",".join(bad) if bad else "全部通过")
        page.evaluate("() => { window.__nr.state.radius = 10; }")

        page.click("#nearby-close")
        page.wait_for_timeout(300)
        check("关闭生效", page.evaluate("() => document.querySelector('#nearby-sheet').classList.contains('hidden')"))

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
