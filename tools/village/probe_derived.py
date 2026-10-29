"""检查镜像仓库是否发布了「五级点位汇总」等小体积派生物（仓库树 + 全部 release 资产 + LFS）。"""
import json
import urllib.request

UA = {"User-Agent": "Mozilla/5.0", "Accept": "application/vnd.github+json"}
REPOS = [
    "chenzhuanxin/china-administrative-divisions-5level",
    "thedavidweng/china-village-boundaries",
]
KEY = ("点位", "汇总", "point", "centroid", "geo", "level3", "level4", "ok_", "area")


def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.load(r)


for repo in REPOS:
    print(f"\n===== {repo} =====")
    try:
        tree = get(f"https://api.github.com/repos/{repo}/git/trees/HEAD?recursive=1")
        blobs = [t for t in tree.get("tree", []) if t["type"] == "blob"]
        print(f"  仓库文件 {len(blobs)} 个，命中关键词的：")
        hit = [t for t in blobs if any(k.lower() in t["path"].lower() for k in KEY)]
        for t in hit[:30]:
            print(f"    {t['path']:<70} {t.get('size', 0)/1048576:>8.2f} MB")
        if not hit:
            print("    （无）")
    except Exception as exc:  # noqa: BLE001
        print("  tree ERR:", repr(exc))

    try:
        rels = get(f"https://api.github.com/repos/{repo}/releases")
        for r in rels:
            print(f"  release {r['tag_name']}:")
            for a in r["assets"]:
                nm = a["name"].lower()
                if any(k.lower() in nm for k in KEY) and "village-boundaries" not in nm:
                    print(f"    [命中] {a['name']:<50} {a['size']/1048576:>8.2f} MB")
                    print(f"           {a['browser_download_url']}")
    except Exception as exc:  # noqa: BLE001
        print("  release ERR:", repr(exc))
