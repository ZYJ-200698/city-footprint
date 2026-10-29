"""分段下载云南村界 zip（逐段重试、逐段校验），随后抽取并解析 DBF 属性表。

只解析 .dbf（其中已含 X/Y 中心点），不解码 24MB 的 .shp 几何。
"""
import json
import os
import struct
import subprocess
import sys
import time
import zipfile

import shapefile

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
os.makedirs(CACHE, exist_ok=True)

REL = (
    "https://github.com/chenzhuanxin/china-administrative-divisions-5level"
    "/releases/download/v2026.10/village-boundaries-yunnan.zip"
)
URLS = ["https://ghfast.top/" + REL, REL]
ZIP_PATH = os.path.join(CACHE, "village-boundaries-yunnan.zip")
PARTS = 16


def curl_head_len(url: str) -> int | None:
    out = subprocess.run(
        ["curl", "-sIL", "-m", "40", url], capture_output=True, text=True
    ).stdout
    lens = [
        int(l.split(":", 1)[1].strip())
        for l in out.splitlines()
        if l.lower().startswith("content-length")
    ]
    return lens[-1] if lens else None


def fetch_range(url: str, start: int, end: int, dest: str) -> bool:
    expect = end - start + 1
    subprocess.run(
        [
            "curl", "-sL", "--max-time", "300", "--retry", "2",
            "-r", f"{start}-{end}", "-o", dest, url,
        ],
        capture_output=True,
    )
    return os.path.exists(dest) and os.path.getsize(dest) == expect


def download() -> int:
    if os.path.exists(ZIP_PATH) and os.path.getsize(ZIP_PATH) > 17_000_000:
        print(f"[skip] zip 已存在 {os.path.getsize(ZIP_PATH)} 字节")
        return os.path.getsize(ZIP_PATH)

    total = None
    for u in URLS:
        total = curl_head_len(u)
        if total:
            print(f"[长度] {total} 字节  (via {u.split('/')[2]})")
            break
    if not total:
        print("!! 无法获取远端长度")
        sys.exit(1)

    chunk = (total + PARTS - 1) // PARTS
    ranges = []
    for i in range(PARTS):
        s = i * chunk
        e = min(s + chunk - 1, total - 1)
        ranges.append((i, s, e))

    results = {}
    pending = list(ranges)
    for attempt in range(1, 7):
        if not pending:
            break
        print(f"\n--- 第 {attempt} 轮，待下载 {len(pending)} 段 ---")
        nxt = []
        for idx, s, e, in [(i, a, b) for i, a, b in pending]:
            dest = os.path.join(CACHE, f"part_{idx:02d}")
            ok = False
            for u in URLS:
                if fetch_range(u, s, e, dest):
                    ok = True
                    break
            if ok:
                results[idx] = dest
                print(f"   part_{idx:02d} OK  ({os.path.getsize(dest)} 字节)")
            else:
                nxt.append((idx, s, e))
                print(f"   part_{idx:02d} 失败")
        pending = nxt
        if pending:
            time.sleep(2)

    if pending:
        print(f"!! 仍有 {len(pending)} 段未成功：{[p[0] for p in pending]}")
        sys.exit(1)

    with open(ZIP_PATH, "wb") as out:
        for idx, _, _ in ranges:
            with open(results[idx], "rb") as fh:
                out.write(fh.read())
    actual = os.path.getsize(ZIP_PATH)
    print(f"\n[合并] {actual} 字节  期望 {total}  -> {'SIZE_OK' if actual == total else 'SIZE_MISMATCH'}")
    for p in results.values():
        os.remove(p)
    return actual


def extract_dbf() -> str:
    with zipfile.ZipFile(ZIP_PATH) as zf:
        names = zf.namelist()
        print("\n[压缩包内容]")
        for info in zf.infolist():
            if not info.is_dir():
                print(f"   {info.filename:<40} {info.file_size/1048576:>8.2f} MB")
        dbfs = [n for n in names if n.lower().endswith(".dbf")]
        if not dbfs:
            print("!! zip 内无 DBF")
            sys.exit(1)
        target = dbfs[0]
        dest = os.path.join(CACHE, "yunnan_village.dbf")
        with zf.open(target) as src, open(dest, "wb") as fh:
            fh.write(src.read())
        print(f"\n[抽取] {target} -> {dest} ({os.path.getsize(dest)/1048576:.2f} MB)")
        return dest


def parse_dbf(path: str) -> None:
    with shapefile.Reader(dbf=path, encoding="utf-8", encodingErrors="replace") as reader:
        fields = [f[0] for f in reader.fields if f[0] != "DeletionFlag"]
        records = reader.records()
    print(f"\n[解析] 记录数 = {len(records)}")
    print(f"[字段] {fields}")

    rows = []
    bad_xy = 0
    for rec in records:
        d = dict(zip(fields, rec))
        try:
            x = float(d.get("X"))
            y = float(d.get("Y"))
        except (TypeError, ValueError):
            bad_xy += 1
            continue
        rows.append(
            {
                "pac": str(d.get("PAC") or "").strip(),
                "name": str(d.get("NAME") or "").strip(),
                "dispname": str(d.get("DISPNAME") or "").strip(),
                "fullname": str(d.get("FULLNAME") or "").strip(),
                "uppac": str(d.get("UPPAC") or "").strip(),
                "upname": str(d.get("UPNAME") or "").strip(),
                "bz": str(d.get("BZ") or "").strip(),
                "x": round(x, 6),
                "y": round(y, 6),
            }
        )

    xs = [r["x"] for r in rows]
    ys = [r["y"] for r in rows]
    print(f"[坐标] X {min(xs):.4f} ~ {max(xs):.4f}   Y {min(ys):.4f} ~ {max(ys):.4f}")
    print(f"[坐标缺失] {bad_xy} 条")
    print(f"[PAC 长度分布] {sorted({len(r['pac']) for r in rows})}")
    print(f"[样例 3 条]")
    for r in rows[:3]:
        print("   ", json.dumps(r, ensure_ascii=False))

    out = os.path.join(CACHE, "yunnan_points_raw.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(rows, fh, ensure_ascii=False)
    print(f"\n[输出] {out} ({os.path.getsize(out)/1048576:.2f} MB)")


if __name__ == "__main__":
    download()
    dbf = extract_dbf()
    parse_dbf(dbf)
