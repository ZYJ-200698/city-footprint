"""探测 china-village-boundaries 仓库中云南村界目录的文件与体积（只读，不下载大文件）。"""
import json
import urllib.parse
import urllib.request

REPO = "thedavidweng/china-village-boundaries"
UA = {"User-Agent": "Mozilla/5.0", "Accept": "application/vnd.github+json"}


def api(path):
    url = f"https://api.github.com/repos/{REPO}/contents/" + urllib.parse.quote(path)
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.load(r)


for p in ["全国村界", "全国村界/云南村界"]:
    try:
        data = api(p)
        print(f"== {p}  entries={len(data)}")
        for f in data[:25]:
            size = f.get("size")
            size_mb = f"{size / 1048576:.2f} MB" if isinstance(size, int) else ""
            print(f"   {f['name']:<40} {f['type']:<4} {size_mb}")
    except Exception as exc:  # noqa: BLE001
        print("ERR", p, repr(exc))

print("\n== 依赖检查 ==")
for mod in ("shapefile", "dbfread", "geopandas", "fiona", "pyproj"):
    try:
        __import__(mod)
        print(f"   {mod}: OK")
    except Exception:  # noqa: BLE001
        print(f"   {mod}: MISSING")
