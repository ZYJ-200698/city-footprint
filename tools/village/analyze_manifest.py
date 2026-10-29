"""预检：逐省检查 DBF 是否含坐标字段（决定是否必须下载 .shp 算质心）。

输入：cache/metadata_dw.json（含每省每个 .shp 的字段清单）
输出：cache/province_plan.json + 控制台报表
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
META = os.path.join(CACHE, "metadata_dw.json")

COORD = {"x", "y", "坐标x", "坐标y", "x中心点", "y中心点", "centroid_x", "centroid_y", "lon", "lat"}

NAME_C = ["XZQMC", "xzqmc", "NAME", "name", "Name", "村名称", "村级名", "CJDCQMC", "zldwmc",
          "area_name", "sqmc", "CUNMC", "村名", "comname", "comname_1", "CNAME", "PNAME", "SNAME",
          "CZCUNMC", "SQCMC", "行政村", "cun_name", "村级", "CUN_MC", "cun", "XZQM", "NAME_TC"]
CODE_C = ["XZQDM", "xzqdm", "AREA_CODE", "PAC", "code", "CODE", "村代码", "村级码", "CJDCQDM",
          "zldwdm", "area_code", "sqbm", "SQBM", "CUNDM", "comid", "comid_1", "AREA_ID", "CACODE",
          "XJDM", "XJDM1", "CZCUNDM", "SQCDM", "XZBM", "pcode", "CUN", "BLOCK_ID", "DJZQDM"]


def pick(fields, cands):
    for c in cands:
        if c in fields:
            return c
    return None


def main():
    with open(META, encoding="utf-8") as fh:
        meta = json.load(fh)
    provs = meta["provinces"]
    print(f"省份条目 {len(provs)} 个\n")

    plan = []
    no_xy = []
    for prov_name, info in provs.items():
        dsets = info.get("datasets") or []
        has_xy = False
        name_f = code_f = None
        records = 0
        for d in dsets:
            records += d.get("records", 0)
            fields = [f["name"] for f in d.get("fields", [])]
            low = {x.lower() for x in fields}
            if low & COORD:
                has_xy = True
            name_f = name_f or pick(fields, NAME_C)
            code_f = code_f or pick(fields, CODE_C)
        plan.append(
            {
                "province": prov_name,
                "records": records,
                "datasets": len(dsets),
                "hasXY": has_xy,
                "nameField": name_f,
                "codeField": code_f,
            }
        )
        if not has_xy:
            no_xy.append(prov_name)

    plan.sort(key=lambda x: -x["records"])
    print(f"{'省份':<12}{'记录数':>9}{'数据集':>7}  {'坐标':<5}{'名称字段':<14}{'代码字段'}")
    for p in plan:
        print(f"{p['province']:<12}{p['records']:>9}{p['datasets']:>7}  {'有' if p['hasXY'] else '无':<5}"
              f"{str(p['nameField']):<14}{p['codeField']}")

    print(f"\n有坐标字段：{len(plan) - len(no_xy)} 个")
    print(f"无坐标字段：{len(no_xy)} 个 -> {no_xy}")
    print(f"记录总数：{sum(p['records'] for p in plan)}")

    out = os.path.join(CACHE, "province_plan.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(plan, fh, ensure_ascii=False, indent=1)
    print(f"\n已写出 {out}")


if __name__ == "__main__":
    main()
