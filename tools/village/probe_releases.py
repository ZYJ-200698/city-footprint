"""探测数据真实存放位置：Releases / LFS / 外部链接。"""
import json
import urllib.request

UA = {"User-Agent": "Mozilla/5.0", "Accept": "application/vnd.github+json"}


def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.load(r)


for repo in [
    "thedavidweng/china-village-boundaries",
    "chenzhuanxin/china-administrative-divisions-5level",
]:
    print(f"\n===== {repo} =====")
    try:
        rel = get(f"https://api.github.com/repos/{repo}/releases")
        print(f"releases: {len(rel)}")
        for r in rel[:6]:
            print(f"  tag={r['tag_name']}  assets={len(r.get('assets', []))}")
            for a in r.get("assets", [])[:30]:
                print(f"     {a['name']:<45} {a['size'] / 1048576:>8.2f} MB  dl={a['download_count']}")
    except Exception as exc:  # noqa: BLE001
        print("  releases ERR:", repr(exc))

    try:
        tree = get(f"https://api.github.com/repos/{repo}/git/trees/HEAD?recursive=1")
        blobs = [t for t in tree.get("tree", []) if t["type"] == "blob"]
        print(f"  tracked files: {len(blobs)}")
        for t in blobs[:15]:
            print(f"     {t['path']:<60} {t.get('size', 0) / 1048576:>8.2f} MB")
    except Exception as exc:  # noqa: BLE001
        print("  tree ERR:", repr(exc))
