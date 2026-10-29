"""探测：是否存在全国村级点位汇总类小体积数据 + 列出全部分省资产清单。"""
import json
import urllib.request

UA = {"User-Agent": "Mozilla/5.0", "Accept": "application/vnd.github+json"}


def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.load(r)


all_assets = {}
for repo in [
    "chenzhuanxin/china-administrative-divisions-5level",
    "thedavidweng/china-village-boundaries",
]:
    print(f"\n===== {repo} =====")
    rels = get(f"https://api.github.com/repos/{repo}/releases")
    print(f"release 数 = {len(rels)}")
    for r in rels:
        print(f"  tag={r['tag_name']}  assets={len(r['assets'])}  name={r['name']}")
        small = [a for a in r["assets"] if a["size"] < 200 * 1048576 and not a["name"].startswith("village-boundaries-")]
        for a in small:
            print(f"     [小资产] {a['name']:<45} {a['size']/1048576:>8.2f} MB  {a['browser_download_url']}")
        for a in r["assets"]:
            if a["name"].startswith("village-boundaries-"):
                prov = a["name"].replace("village-boundaries-", "").replace(".zip", "")
                all_assets[prov] = a["size"]

print(f"\n===== 分省村界 zip 体积汇总（{len(all_assets)} 个）=====")
total = 0
for prov, size in sorted(all_assets.items(), key=lambda kv: kv[1]):
    print(f"  {prov:<16} {size/1048576:>9.2f} MB")
    total += size
print(f"  ---- 合计 {total/1048576/1024:.2f} GB（{total/1048576:.0f} MB）")
