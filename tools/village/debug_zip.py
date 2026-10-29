"""调试：逐步复现 zip 中央目录读取，定位海南失败点。"""
import struct
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_provinces as bp

en = sys.argv[1] if len(sys.argv) > 1 else "hainan"
url = bp.REL_BASE.format(en=en)

print("url:", url)
total = bp.head_size(url)
print("head_size ->", total)

tail_len = min(70000, total)
tail = bp.fetch(url, total - tail_len, total - 1)
print("tail fetch ->", None if tail is None else f"{len(tail)} bytes")
if tail:
    i = tail.rfind(b"PK\x05\x06")
    print("EOCD index:", i)
    if i >= 0:
        cd_size, cd_off = struct.unpack("<II", tail[i + 12:i + 20])
        print("cd_size:", cd_size, "cd_off:", cd_off)
        cd = bp.fetch(url, cd_off, cd_off + cd_size - 1, seg=2)
        print("cd fetch ->", None if cd is None else f"{len(cd)} bytes")
        if cd:
            p, n = 0, 0
            while p + 46 <= len(cd) and cd[p:p + 4] == b"PK\x01\x02":
                nlen, elen, clen = struct.unpack("<HHH", cd[p + 28:p + 34])
                csize = struct.unpack("<I", cd[p + 20:p + 24])[0]
                name = cd[p + 46:p + 46 + nlen].decode("utf-8", "replace")
                print(f"  entry: {name}  csize={csize}")
                p += 46 + nlen + elen + clen
                n += 1
            print("entries:", n)
    else:
        print("tail 前 16 字节:", tail[:16])
        print("tail 后 16 字节:", tail[-16:])
