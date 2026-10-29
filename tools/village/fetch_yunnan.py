"""下载云南村界数据并解析属性表（DBF），输出统计信息。

只读 .dbf（属性表已含 X/Y 中心点），不解码 .shp 几何，速度更快。
"""
import json
import os
import sys
import urllib.request
import zipfile

import shapefile

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
os.makedirs(CACHE, exist_ok=True)

URL = (
    "https://github.com/chenzhuanxin/china-administrative-divisions-5level"
    "/releases/download/v2026.10/village-boundaries-yunnan.zip"
)
ZIP_PATH = os.path.join(CACHE, "village-boundaries-yunnan.zip")


def download() -> None:
    if os.path.exists(ZIP_PATH) and os.path.getsize(ZIP_PATH) > 15_000_000:
        print(f"[skip] 已存在 {os.path.getsize(ZIP_PATH)/1048576:.2f} MB")
        return
    print("[下载]", URL)
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=300) as resp, open(ZIP_PATH, "wb") as fh:
        total = 0
        while True:
            chunk = resp.read(1 << 20)
            if not chunk:
                break
            fh.write(chunk)
            total += len(chunk)
            if total % (4 << 20) < (1 << 20):
                print(f"   {total/1048576:.1f} MB ...", flush=True)
    print(f"[完成] {os.path.getsize(ZIP_PATH)/1048576:.2f} MB")


def fix_name(info: zipfile.ZipInfo) -> str:
    name = info.filename
    if info.flag_bits & 0x800:
        return name
    try:
        return name.encode("cp437").decode("gbk")
    except Exception:  # noqa: BLE001
        return name


def main() -> None:
    download()
    with zipfile.ZipFile(ZIP_PATH) as zf:
        members = [(fix_name(i), i) for i in zf.infolist() if not i.is_dir()]
        print("\n[压缩包内容]")
        for name, info in members:
            print(f"   {name:<50} {info.file_size/1048576:>8.2f} MB")

        dbfs = [(n, i) for n, i in members if n.lower().endswith(".dbf")]
        if not dbfs:
            print("!! 未找到 DBF")
            sys.exit(1)

        for name, info in dbfs:
            safe = os.path.join(CACHE, "yunnan_" + os.path.basename(name).replace(" ", "_"))
            with zf.open(info) as src, open(safe, "wb") as dst:
                dst.write(src.read())
            print(f"\n[读取 DBF] {safe}  ({os.path.getsize(safe)/1048576:.2f} MB)")

            with shapefile.Reader(dbf=safe, encoding="utf-8", encodingErrors="replace") as reader:
                fields = [f[0] for f in reader.fields if f[0] != "DeletionFlag"]
                records = reader.records()
                print(f"   记录数 = {len(records)}")
                print(f"   字段   = {fields}")
                print("\n   前 3 条记录：")
                for rec in records[:3]:
                    print("    ", dict(zip(fields, rec)))

                sample = []
                for rec in records:
                    d = dict(zip(fields, rec))
                    sample.append(d)

            out = os.path.join(CACHE, "yunnan_raw_records.json")
            with open(out, "w", encoding="utf-8") as fh:
                json.dump(sample, fh, ensure_ascii=False)
            print(f"\n[已保存原始记录] {out}  ({os.path.getsize(out)/1048576:.2f} MB)")


if __name__ == "__main__":
    main()
