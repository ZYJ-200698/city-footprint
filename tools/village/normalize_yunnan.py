"""云南村级点位归一化：编码修正、坐标过滤、层级派生、坐标系实证校验、WGS84→GCJ-02 转换、分省打包。

关键产出：src/assets/data/village/52.json（云南全量村级点位）
坐标系决策由「点是否落在云南多边形内」的实证结果驱动，不靠猜。
"""
import json
import math
import os
import re
import sys

import shapefile

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
PROJECT = os.path.abspath(os.path.join(HERE, "..", ".."))
CHINA_GEO = os.path.join(PROJECT, "src", "assets", "geo", "china.json")
YUNNAN_CITY_GEO = os.path.join(PROJECT, "src", "assets", "geo", "city", "530000.json")
OUT_DIR = os.path.join(PROJECT, "src", "assets", "data", "village")
DBF = os.path.join(CACHE, "yunnan_village.dbf")

CJK = re.compile(r"[\u4e00-\u9fff]")

# ---------- WGS84 -> GCJ-02 ----------
_A = 6378245.0
_EE = 0.00669342162296594323


def _out_of_china(lng: float, lat: float) -> bool:
    return not (72.004 <= lng <= 137.8347 and 0.8293 <= lat <= 55.8271)


def _transform_lat(lng: float, lat: float) -> float:
    ret = -100.0 + 2.0 * lng + 3.0 * lat + 0.2 * lat * lat + 0.1 * lng * lat + 0.2 * math.sqrt(abs(lng))
    ret += (20.0 * math.sin(6.0 * lng * math.pi) + 20.0 * math.sin(2.0 * lng * math.pi)) * 2.0 / 3.0
    ret += (20.0 * math.sin(lat * math.pi) + 40.0 * math.sin(lat / 3.0 * math.pi)) * 2.0 / 3.0
    ret += (160.0 * math.sin(lat / 12.0 * math.pi) + 320 * math.sin(lat * math.pi / 30.0)) * 2.0 / 3.0
    return ret


def _transform_lng(lng: float, lat: float) -> float:
    ret = 300.0 + lng + 2.0 * lat + 0.1 * lng * lng + 0.1 * lng * lat + 0.1 * math.sqrt(abs(lng))
    ret += (20.0 * math.sin(6.0 * lng * math.pi) + 20.0 * math.sin(2.0 * lng * math.pi)) * 2.0 / 3.0
    ret += (20.0 * math.sin(lng * math.pi) + 40.0 * math.sin(lng / 3.0 * math.pi)) * 2.0 / 3.0
    ret += (150.0 * math.sin(lng / 12.0 * math.pi) + 300.0 * math.sin(lng / 30.0 * math.pi)) * 2.0 / 3.0
    return ret


def wgs2gcj(lng: float, lat: float) -> tuple[float, float]:
    if _out_of_china(lng, lat):
        return lng, lat
    dlat = _transform_lat(lng - 105.0, lat - 35.0)
    dlng = _transform_lng(lng - 105.0, lat - 35.0)
    radlat = lat / 180.0 * math.pi
    magic = 1 - _EE * math.sin(radlat) ** 2
    sqrtmagic = math.sqrt(magic)
    dlat = (dlat * 180.0) / ((_A * (1 - _EE)) / (magic * sqrtmagic) * math.pi)
    dlng = (dlng * 180.0) / (_A / sqrtmagic * math.cos(radlat) * math.pi)
    return lng + dlng, lat + dlat


# ---------- 点是否在多边形内（射线法）----------
def point_in_ring(lng: float, lat: float, ring: list) -> bool:
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if ((yi > lat) != (yj > lat)) and (lng < (xj - xi) * (lat - yi) / (yj - yi + 1e-18) + xi):
            inside = not inside
        j = i
    return inside


def load_prefecture_rings() -> dict[str, list]:
    """返回 {州市adcode(6位字符串): [环, ...]}，用于「村落归属自己州市」检验。"""
    out: dict[str, list] = {}
    with open(YUNNAN_CITY_GEO, encoding="utf-8") as fh:
        geo = json.load(fh)
    for feat in geo.get("features", []):
        adcode = str(feat.get("properties", {}).get("adcode") or "")
        if not adcode:
            continue
        geom = feat.get("geometry", {})
        coords = geom.get("coordinates", [])
        if geom.get("type") == "Polygon":
            coords = [coords]
        rings = []
        for poly in coords:
            for ring in poly:
                rings.append([(float(p[0]), float(p[1])) for p in ring])
        out.setdefault(adcode, []).extend(rings)
    return out


def detect_encoding(path: str) -> str:
    """云南数据 cpg 声明 UTF-8，但实测为 GBK；用中文字符密度自动判定。"""
    best, best_score = "utf-8", -1
    for enc in ("utf-8", "gbk"):
        try:
            with shapefile.Reader(dbf=path, encoding=enc, encodingErrors="replace") as r:
                sample = [d.get("NAME", "") for d in (dict(zip([f[0] for f in r.fields if f[0] != "DeletionFlag"], rec)) for rec in r.records()[:400])]
            joined = "".join(sample)
            score = len(CJK.findall(joined))
            print(f"   [编码测试] {enc}: 中文字符 {score} 个 / 替换符 {joined.count(chr(0xfffd))} 个")
            if score > best_score:
                best, best_score = enc, score
        except Exception as exc:  # noqa: BLE001
            print(f"   [编码测试] {enc} 读取失败: {exc}")
    return best


def main() -> None:
    if not os.path.exists(DBF):
        print("!! 缺少 DBF，请先运行 build_yunnan_points.py")
        sys.exit(1)

    print("== 1. 判定编码 ==")
    enc = detect_encoding(DBF)
    print(f"   -> 采用 {enc}")

    print("\n== 2. 读取并清洗 ==")
    with shapefile.Reader(dbf=DBF, encoding=enc, encodingErrors="replace") as reader:
        fields = [f[0] for f in reader.fields if f[0] != "DeletionFlag"]
        raw = [dict(zip(fields, rec)) for rec in reader.records()]

    total = len(raw)
    rows = []
    no_xy = no_pac = 0
    for d in raw:
        try:
            x, y = float(d.get("X") or 0), float(d.get("Y") or 0)
        except (TypeError, ValueError):
            x = y = 0.0
        if x == 0.0 or y == 0.0:
            no_xy += 1
            continue
        pac = str(d.get("PAC") or "").strip()
        if len(pac) != 12:
            no_pac += 1
            continue
        name = str(d.get("NAME") or "").strip()
        upname = str(d.get("UPNAME") or "").strip()
        if not name:
            continue
        rows.append(
            {
                "pac": pac,
                "name": name,
                "upname": upname,
                "x": x,
                "y": y,
                "prov": pac[:2],
                "city": pac[:4],
                "county": pac[:6],
                "town": pac[:9],
            }
        )
    print(f"   原始 {total} 条 -> 有效 {len(rows)} 条（无坐标 {no_xy}，PAC 非12位 {no_pac}）")
    print(f"   样例: {json.dumps(rows[0], ensure_ascii=False)}")

    print("\n== 3. 坐标系实证校验（每个村应落在自己所属州市内）==")
    rings_by_adcode = load_prefecture_rings()
    print(f"   已载入州市面 {len(rings_by_adcode)} 个")

    step = max(1, len(rows) // 1200)
    sample = rows[::step][:1200]

    def outside_count(converter) -> int:
        bad = 0
        for r in sample:
            adcode = r["pac"][:4] + "00"
            rings = rings_by_adcode.get(adcode)
            if not rings:
                continue
            lng, lat = converter(r["x"], r["y"])
            if not any(point_in_ring(lng, lat, ring) for ring in rings):
                bad += 1
        return bad

    bad_raw = outside_count(lambda a, b: (a, b))
    bad_gcj = outside_count(wgs2gcj)
    n = len(sample)
    print(f"   样本 {n} 个村")
    print(f"   保持原值（视为已是 GCJ-02）：越界 {bad_raw} 个  = {bad_raw/n:.2%}")
    print(f"   按 WGS84 转 GCJ-02       ：越界 {bad_gcj} 个  = {bad_gcj/n:.2%}")

    use_convert = bad_gcj < bad_raw
    print(f"   -> 结论：原始数据应为 {'WGS84，已转 GCJ-02' if use_convert else 'GCJ-02，保持原值'}")
    if bad_raw == bad_gcj:
        print("   !! 两种假设越界数相同，判定力不足；沿用 README 声明（WGS84）执行转换")
        use_convert = True

    print("\n== 4. 转换与打包 ==")
    os.makedirs(OUT_DIR, exist_ok=True)
    out = []
    for r in rows:
        lng, lat = wgs2gcj(r["x"], r["y"]) if use_convert else (r["x"], r["y"])
        out.append([r["pac"], r["name"], r["upname"], round(lng, 5), round(lat, 5)])
    out.sort(key=lambda v: v[0])

    payload = {
        "v": 1,
        "prov": "52",
        "provName": "云南省",
        "crs": "GCJ-02",
        "source": "china-village-boundaries (thedavidweng), 2016±, CC0(原始权利不明)",
        "count": len(out),
        "fields": ["pac", "name", "town", "lng", "lat"],
        "points": out,
    }
    dest = os.path.join(OUT_DIR, "52.json")
    with open(dest, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"), ensure_ascii=False)

    size = os.path.getsize(dest)
    print(f"   -> {dest}")
    print(f"      点位 {len(out)} 条，未经压缩 {size/1024:.0f} KB")
    lngs = [p[3] for p in out]
    lats = [p[4] for p in out]
    print(f"      经度 {min(lngs):.3f} ~ {max(lngs):.3f}  纬度 {min(lats):.3f} ~ {max(lats):.3f}")
    counties = len({p[0][:6] for p in out})
    towns = len({p[0][:9] for p in out})
    print(f"      覆盖：区县 {counties} 个 / 乡镇 {towns} 个 / 村 {len(out)} 个")
    print(f"      估算 gzip 后 ≈ {size*0.28/1024:.0f} KB")


if __name__ == "__main__":
    main()
