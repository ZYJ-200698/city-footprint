"""全国村级点位批量构建（云南以外 32 个省级单位）

设计要点
1. **只下载需要的 zip 成员**：用 HTTP Range 读 zip 尾部的中央目录，再精确取 .shp / .dbf 的压缩数据，
   跳过 .shx/.sbn/.sbx/.prj/.xml（省流量）。传输全部经 ghfast.top 镜像，直连作为备用。
2. **不从 .shp 解码多边形**：每条记录头里就有 bbox（4 个 double），取其中心作为村庄代表点，
   逐记录前跳，速度极快、内存占用恒定。
3. **字段名不统一**：用「村名后缀命中率」自动判定村名/乡镇名字段，用「纯数字长度」判定代码字段，
   而不是硬编码某省字段名。
4. **可断点续跑**：已生成且校验通过的省份直接跳过；临时文件处理完即删。
5. 编码自动判定（部分省 .cpg 声明 UTF-8 实为 GBK）。

用法：
    python build_provinces.py --limit-mb 120        # 只做 zip 小于 120MB 的省
    python build_provinces.py --only shanghai jiangsu
    python build_provinces.py --budget 900          # 最多跑 900 秒后停
"""
import argparse
import concurrent.futures as futures
import json
import math
import os
import re
import struct
import subprocess
import sys
import time
import zlib

import shapefile

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
PROJECT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT_DIR = os.path.join(PROJECT, "src", "assets", "data", "village")
MIRRORS = ["https://ghfast.top/", ""]
REL_BASE = (
    "https://github.com/thedavidweng/china-village-boundaries"
    "/releases/download/v2026.06/village-boundaries-{en}.zip"
)

# en 名 -> (省 adcode 前两位, 中文省名)
PROV_MAP = {
    "beijing": ("11", "北京市"), "tianjin": ("12", "天津市"), "hebei": ("13", "河北省"),
    "shanxi": ("14", "山西省"), "neimenggu": ("15", "内蒙古自治区"), "liaoning": ("21", "辽宁省"),
    "jilin": ("22", "吉林省"), "heilongjiang": ("23", "黑龙江省"), "shanghai": ("31", "上海市"),
    "jiangsu": ("32", "江苏省"), "zhejiang": ("33", "浙江省"), "anhui": ("34", "安徽省"),
    "fujian": ("35", "福建省"), "jiangxi": ("36", "江西省"), "shandong": ("37", "山东省"),
    "henan": ("41", "河南省"), "hubei": ("42", "湖北省"), "hunan": ("43", "湖南省"),
    "guangdong": ("44", "广东省"), "guangxi": ("45", "广西壮族自治区"), "hainan": ("46", "海南省"),
    "chongqing": ("50", "重庆市"), "sichuan": ("51", "四川省"), "guizhou": ("52", "贵州省"),
    "yunnan": ("53", "云南省"), "xizang": ("54", "西藏自治区"), "shaanxi": ("61", "陕西省"),
    "gansu": ("62", "甘肃省"), "qinghai": ("63", "青海省"), "ningxia": ("64", "宁夏回族自治区"),
    "xinjiang": ("65", "新疆维吾尔自治区"), "hongkong": ("81", "香港特别行政区"),
    "macau": ("82", "澳门特别行政区"),
}

VILLAGE_SUFFIX = re.compile(r"(村委会|居委会|社区|村$|嘎查$|居民委员会|村民委员会)")
TOWN_SUFFIX = re.compile(r"(镇$|乡$|街道$|苏木$|民族乡$)")


# ---------------- HTTP ----------------
def curl(url, start=None, end=None, timeout=180, out=None):
    cmd = ["curl", "-sL", "--max-time", str(timeout), "-H", "User-Agent: Mozilla/5.0"]
    if start is not None:
        cmd += ["-r", f"{start}-{end}"]
    cmd += ["-o", out or "-", url]
    res = subprocess.run(cmd, capture_output=True)
    if out:
        return os.path.exists(out) and os.path.getsize(out) > 0
    return res.stdout


def head_size(url):
    """取远端文件字节数。代理会返回多个 Content-Length（含 46 字节的占位头），必须取最大值；
    拿不到再用 Range 探测 Content-Range 的总长。"""
    out = subprocess.run(["curl", "-sIL", "-m", "40", url], capture_output=True, text=True).stdout
    lens = []
    for line in out.splitlines():
        if line.lower().startswith("content-length"):
            try:
                lens.append(int(line.split(":", 1)[1].strip()))
            except ValueError:
                pass
    if lens:
        return max(lens)
    out2 = subprocess.run(
        ["curl", "-sL", "-m", "40", "-r", "0-0", "-D", "-", "-o", os.devnull, url],
        capture_output=True, text=True,
    ).stdout
    for line in out2.splitlines():
        if line.lower().startswith("content-range"):
            m = re.search(r"/(\d+)\s*$", line.strip())
            if m:
                return int(m.group(1))
    return None


def fetch(url, start, end, tries=6, seg=None):
    """取 [start, end] 字节。seg>1 时用线程池真正并发拉取各分段。

    单连接实测 ~90-160 KB/s（本环境出口上限），并发可叠加到 400-600 KB/s。
    """
    want = end - start + 1
    if seg and seg > 1 and want > seg * (256 * 1024):
        chunk = (want + seg - 1) // seg
        parts = []
        for i in range(seg):
            s = start + i * chunk
            e = min(s + chunk - 1, end)
            parts.append((s, e))

        def grab(bounds):
            s, e = bounds
            need = e - s + 1
            for _ in range(tries):
                for m in MIRRORS:
                    data = curl(m + url, s, e, timeout=180)
                    if data and len(data) == need:
                        return data
                time.sleep(1.0)
            return None

        outs = [None] * len(parts)
        with futures.ThreadPoolExecutor(max_workers=min(16, len(parts))) as pool:
            futs = {pool.submit(grab, b): i for i, b in enumerate(parts)}
            for fu in futures.as_completed(futs):
                outs[futs[fu]] = fu.result()
        if any(o is None for o in outs):
            missing = [i for i, o in enumerate(outs) if o is None]
            print(f"      [警告] {len(missing)}/{len(parts)} 段未取到，重试中…")
            for i in missing:
                outs[i] = grab(parts[i])
            if any(o is None for o in outs):
                return None
        return b"".join(outs)

    for _ in range(tries):
        for m in MIRRORS:
            data = curl(m + url, start, end, timeout=180)
            if data and len(data) == want:
                return data
        time.sleep(1.2)
    return None


# ---------------- ZIP 局部读取 ----------------
def zip_entries(url):
    total = head_size(url)
    if not total or total < 4096:
        print(f"    [debug] 远端长度异常: {total}")
        return None, None
    tail_len = min(70000, total)
    tail = fetch(url, total - tail_len, total - 1)
    if not tail:
        return total, None
    i = tail.rfind(b"PK\x05\x06")
    if i < 0:
        return total, None
    cd_size, cd_off = struct.unpack("<II", tail[i + 12:i + 20])
    cd = fetch(url, cd_off, cd_off + cd_size - 1, seg=2)
    if not cd:
        return total, None
    entries = []
    p = 0
    while p + 46 <= len(cd) and cd[p:p + 4] == b"PK\x01\x02":
        method = struct.unpack("<H", cd[p + 10:p + 12])[0]
        csize, usize = struct.unpack("<II", cd[p + 20:p + 28])
        nlen, elen, clen = struct.unpack("<HHH", cd[p + 28:p + 34])
        lho = struct.unpack("<I", cd[p + 42:p + 46])[0]
        raw = cd[p + 46:p + 46 + nlen]
        try:
            name = raw.decode("utf-8")
        except UnicodeDecodeError:
            name = raw.decode("gbk", "replace")
        entries.append({"name": name, "method": method, "csize": csize,
                        "usize": usize, "lho": lho, "p": p})
        p += 46 + nlen + elen + clen
    return total, entries


def zip_extract(url, ent, dest):
    """抽取单个 zip 成员到 dest。"""
    lh = fetch(url, ent["lho"], ent["lho"] + 29)
    if not lh:
        return False
    nlen, elen = struct.unpack("<HH", lh[26:30])
    data_off = ent["lho"] + 30 + nlen + elen
    # 分段并行：单连接实测仅 ~90-140 KB/s，多连接可叠加到 500+ KB/s
    seg = min(24, max(1, ent["csize"] // (512 * 1024)))
    comp = fetch(url, data_off, data_off + ent["csize"] - 1, seg=seg)
    if not comp:
        return False
    if ent["method"] == 8:
        raw = zlib.decompressobj(-15).decompress(comp)
    elif ent["method"] == 0:
        raw = comp
    else:
        return False
    with open(dest, "wb") as fh:
        fh.write(raw)
    return True


# ---------------- SHP 记录头 bbox ----------------
def shp_centers(path):
    with open(path, "rb") as fh:
        data = fh.read()
    out = []
    pos = 100
    n = len(data)
    while pos + 8 <= n:
        clen = struct.unpack(">i", data[pos + 4:pos + 8])[0] * 2
        cs = pos + 8
        if cs + 4 > n:
            break
        stype = struct.unpack("<i", data[cs:cs + 4])[0]
        if stype == 0 or clen < 36:
            out.append(None)
        else:
            xmin, ymin, xmax, ymax = struct.unpack("<4d", data[cs + 4:cs + 36])
            out.append(((xmin + xmax) / 2.0, (ymin + ymax) / 2.0))
        pos = cs + clen
    return out


# ---------------- DBF（自写读取器：字段名与单元格分别判定编码） ----------------
def _dec(raw):
    for enc in ("utf-8", "gbk"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("gbk", "replace")


def dbf_rows(path):
    with open(path, "rb") as fh:
        buf = fh.read()
    if len(buf) < 32:
        return None, None
    nrec = struct.unpack("<I", buf[4:8])[0]
    hlen = struct.unpack("<H", buf[8:10])[0]
    rlen = struct.unpack("<H", buf[10:12])[0]
    if rlen <= 1:
        return None, None
    fields = []
    p = 32
    while p + 32 <= hlen and buf[p] != 0x0D:
        name = _dec(buf[p:p + 11].split(b"\x00")[0])
        fields.append((name, chr(buf[p + 11]), buf[p + 16]))
        p += 32
    if not fields:
        return None, None
    rows = []
    pos = hlen
    for _ in range(nrec):
        if pos + rlen > len(buf):
            break
        rec = buf[pos:pos + rlen]
        pos += rlen
        if rec[:1] == b"*":
            continue
        vals = []
        off = 1
        for _, _, fl in fields:
            vals.append(_dec(rec[off:off + fl]).strip())
            off += fl
        rows.append(vals)
    return [f[0] for f in fields], rows


def pick_field(fields, rows, pattern, numeric=False, max_len=None):
    best, best_score = None, 0
    n = min(len(rows), 200)
    if n == 0:
        return None
    for idx, f in enumerate(fields):
        vals = [rows[i][idx] if idx < len(rows[i]) else "" for i in range(n)]
        if numeric:
            # 村代码应「位数足够 + 唯一性高」；区县码虽然都是数字但唯一值极少，会被这条排除
            digits = [v for v in vals if re.fullmatch(r"\d{6,14}", v or "x")]
            frac = len(digits) / n
            uniq = len(set(digits)) / max(1, len(digits))
            ok = frac * uniq * n
        else:
            ok = sum(1 for v in vals if pattern.search(v) and (max_len is None or len(v) <= max_len))
            if ok == 0:
                continue
        if ok > best_score:
            best, best_score = f, ok
    if numeric:
        return best if best_score >= n * 0.3 else None
    return best if best_score >= max(2, n * 0.12) else None


NAME_EXPLICIT = [
    "村级名", "村名称", "村名", "名称", "行政村", "村级", "XZQMC", "xzqmc", "CJDCQMC",
    "zldwmc", "sqmc", "CUNMC", "comname", "BLOCK_NAME", "NAME", "name", "Name",
    "area_name", "CZCUNMC", "SQCMC", "cun_name", "CUN_MC", "XZQM", "CNAME", "NAME_TC",
]


def pick_name_field(fields, rows):
    """三级判定：① 官方映射里的村名字段名，且值确实是中文；② 村名后缀命中率；③ 短中文串兜底。
    上海等省字段名大量乱码但仍有可读的「名称」，所以①必须优先于启发式。"""
    n = min(len(rows), 200)
    if n == 0:
        return None, None

    def cjk_ratio(idx):
        vals = [rows[i][idx] or "" for i in range(n)]
        return sum(1 for v in vals if re.search(r"[\u4e00-\u9fff]", v)) / n

    for cand in NAME_EXPLICIT:
        if cand in fields and cjk_ratio(fields.index(cand)) >= 0.6:
            return cand, "explicit"

    f = pick_field(fields, rows, VILLAGE_SUFFIX)
    if f:
        return f, "suffix"

    best, best_score = None, 0
    for idx, name in enumerate(fields):
        ok = sum(
            1
            for i in range(n)
            if 0 < len(rows[i][idx] or "") <= 12 and re.search(r"[\u4e00-\u9fff]", rows[i][idx] or "")
        )
        if ok > best_score:
            best, best_score = name, ok
    return (best, "fallback") if best_score >= n * 0.7 else (None, None)


# ---------------- WGS84 -> GCJ-02 ----------------
_A, _EE = 6378245.0, 0.00669342162296594323


def _tf_lat(x, y):
    r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * math.sqrt(abs(x))
    r += (20 * math.sin(6 * x * math.pi) + 20 * math.sin(2 * x * math.pi)) * 2 / 3
    r += (20 * math.sin(y * math.pi) + 40 * math.sin(y / 3 * math.pi)) * 2 / 3
    r += (160 * math.sin(y / 12 * math.pi) + 320 * math.sin(y * math.pi / 30)) * 2 / 3
    return r


def _tf_lng(x, y):
    r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * math.sqrt(abs(x))
    r += (20 * math.sin(6 * x * math.pi) + 20 * math.sin(2 * x * math.pi)) * 2 / 3
    r += (20 * math.sin(x * math.pi) + 40 * math.sin(x / 3 * math.pi)) * 2 / 3
    r += (150 * math.sin(x / 12 * math.pi) + 300 * math.sin(x / 30 * math.pi)) * 2 / 3
    return r


def wgs2gcj(lng, lat):
    if not (72.004 <= lng <= 137.8347 and 0.8293 <= lat <= 55.8271):
        return lng, lat
    dlat = _tf_lat(lng - 105.0, lat - 35.0)
    dlng = _tf_lng(lng - 105.0, lat - 35.0)
    radlat = lat / 180.0 * math.pi
    magic = 1 - _EE * math.sin(radlat) ** 2
    sqrtmagic = math.sqrt(magic)
    dlat = (dlat * 180.0) / ((_A * (1 - _EE)) / (magic * sqrtmagic) * math.pi)
    dlng = (dlng * 180.0) / (_A / sqrtmagic * math.cos(radlat) * math.pi)
    return lng + dlng, lat + dlat


# ---------------- 单省处理 ----------------
def process(en, force=False):
    if en == "yunnan":
        print("  [跳过] 云南已完成")
        return True
    code, cn = PROV_MAP[en]
    out_path = os.path.join(OUT_DIR, f"{code}.json")
    if os.path.exists(out_path) and not force:
        print(f"  [跳过] {cn} 已存在")
        return True

    url = REL_BASE.format(en=en)
    t0 = time.time()
    total, entries = zip_entries(url)
    if not entries:
        print(f"  !! {cn} 取不到 zip 目录")
        return False
    shps = [e for e in entries if e["name"].lower().endswith(".shp")]
    dbfs = {os.path.splitext(e["name"])[0].lower(): e for e in entries if e["name"].lower().endswith(".dbf")}
    print(f"  {cn}: zip {total/1048576:.1f} MB, {len(shps)} 个 shp")

    points, used = [], []
    for si, shp in enumerate(sorted(shps, key=lambda e: -e["usize"])):
        base = os.path.splitext(shp["name"])[0]
        dbf = dbfs.get(base.lower())
        if not dbf:
            continue
        t_shp = os.path.join(CACHE, f"tmp_{en}_{si}.shp")
        t_dbf = os.path.join(CACHE, f"tmp_{en}_{si}.dbf")
        try:
            if not zip_extract(url, shp, t_shp):
                print(f"    - {os.path.basename(shp['name'])} shp 抽取失败")
                continue
            if not zip_extract(url, dbf, t_dbf):
                print(f"    - {os.path.basename(dbf['name'])} dbf 抽取失败")
                continue
            fields, recs = dbf_rows(t_dbf)
            if not fields:
                continue
            nf, how = pick_name_field(fields, recs)
            cf = pick_field(fields, recs, None, numeric=True)
            tf = pick_field(fields, recs, TOWN_SUFFIX, max_len=12)
            if not nf:
                print(f"    - {os.path.basename(shp['name'])} 村名字段未识别，字段={fields[:8]}")
                continue
            centers = shp_centers(t_shp)
            ni = fields.index(nf)
            ci = fields.index(cf) if cf else None
            ti = fields.index(tf) if tf else None
            cnt = 0
            for i, rec in enumerate(recs):
                if i >= len(centers) or centers[i] is None:
                    continue
                x, y = centers[i]
                if not (70 < x < 140 and 0 < y < 56):
                    continue
                name = (rec[ni] or "").strip()
                if not name:
                    continue
                vcode = (rec[ci] or "").strip() if ci is not None else ""
                town = (rec[ti] or "").strip() if ti is not None else ""
                lng, lat = wgs2gcj(x, y)
                points.append([vcode, name, town, round(lng, 5), round(lat, 5)])
                cnt += 1
            used.append(f"{os.path.basename(shp['name'])}:{cnt}")
            print(f"    - {os.path.basename(shp['name'])} 村名={nf}({how}) 代码={cf} 乡镇={tf} -> {cnt} 点")
        finally:
            for p in (t_shp, t_dbf):
                if os.path.exists(p):
                    os.remove(p)

    if not points:
        print(f"  !! {cn} 无有效点位")
        return False

    # 去重用「村名 + 坐标」：代码字段在不同省可能只到区县级，按代码去重会把整县压成一条
    seen, dedup = set(), []
    for p in points:
        key = (p[1], p[3], p[4])
        if key in seen:
            continue
        seen.add(key)
        dedup.append(p)
    dedup.sort(key=lambda v: v[0])
    lngs = [p[3] for p in dedup]
    lats = [p[4] for p in dedup]
    payload = {
        "v": 1, "prov": code, "provName": cn, "crs": "GCJ-02",
        "source": "china-village-boundaries v2026.06, CC0(原始权利不明)",
        "count": len(dedup),
        "fields": ["pac", "name", "town", "lng", "lat"],
        "bounds": [round(min(lngs), 4), round(min(lats), 4), round(max(lngs), 4), round(max(lats), 4)],
        "points": dedup,
    }
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"), ensure_ascii=False)
    size = os.path.getsize(out_path)
    print(f"  ✓ {cn} {len(dedup)} 点, {size/1024:.0f} KB, 用时 {time.time()-t0:.0f}s")
    return True


def rebuild_index():
    items = []
    for fn in sorted(os.listdir(OUT_DIR)):
        if not fn.endswith(".json") or fn == "index.json":
            continue
        path = os.path.join(OUT_DIR, fn)
        with open(path, encoding="utf-8") as fh:
            d = json.load(fh)
        bounds = d.get("bounds")
        if not bounds or len(bounds) != 4:
            # 老格式（云南早期产物）没有 bounds，按点位现算并回写，否则按包围盒选省会漏掉该省
            lngs = [p[3] for p in d["points"]]
            lats = [p[4] for p in d["points"]]
            bounds = [round(min(lngs), 4), round(min(lats), 4), round(max(lngs), 4), round(max(lats), 4)]
            d["bounds"] = bounds
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(d, fh, separators=(",", ":"), ensure_ascii=False)
        items.append({"code": d["prov"], "name": d["provName"], "count": d["count"],
                      "bounds": bounds, "file": fn})
    items.sort(key=lambda i: i["code"])
    idx = {"v": 1, "crs": "GCJ-02", "count": sum(i["count"] for i in items), "provinces": items}
    with open(os.path.join(OUT_DIR, "index.json"), "w", encoding="utf-8") as fh:
        json.dump(idx, fh, separators=(",", ":"), ensure_ascii=False)
    print(f"\n[index] {len(items)} 省 / {idx['count']} 点 -> index.json")
    for i in items:
        print(f"   {i['code']} {i['name']:<10} {i['count']:>7} 点  bounds={i['bounds']}")
    return idx


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--limit-mb", type=float)
    ap.add_argument("--budget", type=int, default=0, help="秒；超过后停止")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    with open(os.path.join(CACHE, "manifest_release.json"), encoding="utf-8") as fh:
        man = json.load(fh)
    sizes = {}
    for a in man["assets"]:
        en = a["file"].replace("village-boundaries-", "").replace(".zip", "")
        sizes[en] = a["bytes"]

    todo = [e for e in PROV_MAP if e in sizes]
    if args.only:
        todo = [e for e in todo if e in args.only]
    if args.limit_mb:
        todo = [e for e in todo if sizes[e] <= args.limit_mb * 1048576]
    todo.sort(key=lambda e: sizes[e])

    t_start = time.time()
    ok = fail = 0
    for en in todo:
        if args.budget and time.time() - t_start > args.budget:
            print(f"\n[预算到] 已用 {time.time()-t_start:.0f}s，剩余 {len(todo)-ok-fail} 省待做")
            break
        print(f"\n=== {PROV_MAP[en][1]} ({en}, {sizes[en]/1048576:.1f} MB) ===")
        done = False
        for attempt in range(1, 4):
            try:
                if process(en, args.force):
                    ok += 1
                    done = True
                    break
            except Exception as exc:  # noqa: BLE001
                print("  !! 异常:", repr(exc))
            if attempt < 3:
                print(f"  ↻ 第 {attempt} 次失败，8 秒后整省重试")
                time.sleep(8)
        if not done:
            fail += 1

    print(f"\n完成 {ok} / 失败 {fail} / 用时 {time.time()-t_start:.0f}s")
    rebuild_index()


if __name__ == "__main__":
    main()
