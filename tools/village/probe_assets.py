"""列出两个仓库 Releases 的全部资产，重点寻找体积更小的派生点位数据。"""
import json
import urllib.request

UA = {"User-Agent": "Mozilla/5.0", "Accept": "application/vnd.github+json"}


def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.load(r)


for repo in [
    "chenzhuanxin/china-administrative-divisions-5level",
    "thedavidweng/china-village-boundaries",
]:
    print(f"\n===== {repo} =====")
    rel = get(f"https://api.github.com/repos/{repo}/releases")
    for r in rel:
        assets = r.get("assets", [])
        print(f"tag={r['tag_name']}  资产数={len(assets)}")
        interesting = [a for a in assets if not a["name"].startswith("village-boundaries-")]
        print("  -- 非分省村界资产（更可能是我们需要的小体积派生物）--")
        for a in interesting:
            print(f"     {a['name']:<48} {a['size'] / 1048576:>8.2f} MB")
        yn = [a for a in assets if "yunnan" in a["name"]]
        for a in yn:
            print(f"  -- 云南村界 -- {a['name']}  {a['size'] / 1048576:.2f} MB")
            print(f"     url={a['browser_download_url']}")
