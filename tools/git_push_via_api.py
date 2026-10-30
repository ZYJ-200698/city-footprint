"""在 github.com:443 不可达时，用 GitHub Git Data API 把本地提交原样复刻到远端。

原理：Git 提交哈希由 tree/parent/author/committer/message 决定。只要远端 tree 与本地
一致、父提交链一致、作者与提交时间一致，复刻出的提交 SHA 就与本地完全相同 ——
不会产生分叉历史。

每个提交严格校验：远端返回的 tree SHA、commit SHA 必须等于本地；任一不符即中止。
"""
import base64
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

REPO = "ZYJ-200698/city-footprint"
API = "https://api.github.com"
BRANCH = "main"
PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def token():
    with open(os.path.expanduser("~/.git-credentials"), encoding="utf-8") as fh:
        raw = fh.read()
    m = re.search(r"https://[^:]+:([^@]+)@github\.com", raw)
    if not m:
        sys.exit("未找到 GitHub token")
    return m.group(1)


TOKEN = token()


def git(*args, binary=False):
    res = subprocess.run(["git", "-C", PROJECT] + list(args), capture_output=True)
    if res.returncode != 0:
        sys.exit(f"git {' '.join(args)} 失败: {res.stderr.decode('utf-8', 'replace')[:400]}")
    return res.stdout if binary else res.stdout.decode("utf-8", "replace").strip()


def api(method, path, payload=None, tries=4):
    url = API + path
    body = json.dumps(payload).encode() if payload is not None else None
    for attempt in range(1, tries + 1):
        req = urllib.request.Request(url, data=body, method=method)
        req.add_header("Authorization", f"Bearer {TOKEN}")
        req.add_header("Accept", "application/vnd.github+json")
        req.add_header("User-Agent", "city-footprint-push")
        if body:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=300) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:400]
            if exc.code in (422,) or attempt == tries:
                sys.exit(f"{method} {path} -> HTTP {exc.code}: {detail}")
            print(f"     ! HTTP {exc.code}，{attempt}/{tries} 重试… {detail[:120]}")
        except Exception as exc:  # noqa: BLE001
            if attempt == tries:
                sys.exit(f"{method} {path} 失败: {exc!r}")
            print(f"     ! {exc!r}，{attempt}/{tries} 重试…")
        time.sleep(2 * attempt)


def parse_commit(sha):
    # 必须用原始字节：提交信息末尾的换行参与 SHA 计算，strip 掉就会导致复刻出的 SHA 不符
    raw = git("cat-file", "commit", sha, binary=True).decode("utf-8", "replace")
    header, _, message = raw.partition("\n\n")
    tree = parent = author = committer = None
    for line in header.splitlines():
        if line.startswith("tree "):
            tree = line[5:].strip()
        elif line.startswith("parent "):
            parent = line[7:].strip()
        elif line.startswith("author "):
            author = line[7:].strip()
        elif line.startswith("committer "):
            committer = line[10:].strip()
    return {"tree": tree, "parent": parent, "author": author,
            "committer": committer, "message": message}


def split_identity(line):
    """'Name <email> 1759900000 +0800' -> (name, email, iso8601)"""
    m = re.match(r"^(.*?)\s*<([^>]*)>\s*(\d+)\s*([+-]\d{4})$", line)
    if not m:
        sys.exit(f"无法解析身份行: {line}")
    name, email, ts, tz = m.group(1), m.group(2), int(m.group(3)), m.group(4)
    sign = 1 if tz[0] == "+" else -1
    offset = timedelta(hours=int(tz[1:3]), minutes=int(tz[3:5])) * sign
    dt = datetime.fromtimestamp(ts, tz=timezone(offset))
    return name, email, dt.strftime("%Y-%m-%dT%H:%M:%S") + tz[:3] + ":" + tz[3:]


def changed_paths(parent, sha):
    out = git("diff-tree", "--no-commit-id", "--name-status", "-r", parent, sha)
    rows = []
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) >= 2:
            rows.append((parts[0][0], parts[-1]))
    return rows


def tree_entry(sha, path):
    line = git("ls-tree", sha, "--", path)
    if not line:
        return None
    meta, _, _ = line.partition("\t")
    mode, otype, osha = meta.split()
    return {"path": path, "mode": mode, "type": otype, "sha": osha}


def main():
    remote_head = api("GET", f"/repos/{REPO}/git/ref/heads/{BRANCH}")["object"]["sha"]
    local_base = git("rev-parse", "origin/main")
    print(f"远端 HEAD : {remote_head[:10]}  {api('GET', f'/repos/{REPO}/commits/{remote_head}')['commit']['message'].splitlines()[0][:50]}")
    print(f"本地 origin/main: {local_base[:10]}")
    if remote_head != local_base:
        print("!! 远端与本地记录的 origin/main 不一致，仍将以远端实际 HEAD 作为基线继续")

    commits = git("rev-list", "--reverse", f"{remote_head}..main").split()
    if not commits:
        print("没有待推送的提交")
        return
    print(f"待复刻提交 {len(commits)} 个\n")

    parent = remote_head
    for i, sha in enumerate(commits, 1):
        c = parse_commit(sha)
        if c["parent"] != parent:
            sys.exit(f"{sha[:8]} 的父提交 {c['parent'][:8]} != 期望 {parent[:8]}")
        subject = c["message"].splitlines()[0][:60]
        print(f"[{i}/{len(commits)}] {sha[:8]} {subject}")

        entries = []
        for status, path in changed_paths(parent, sha):
            if status == "D":
                entries.append({"path": path, "mode": "100644", "type": "blob", "sha": None})
                print(f"    D {path}")
                continue
            ent = tree_entry(sha, path)
            if not ent:
                sys.exit(f"取不到 {path} 的 tree 项")
            content = git("cat-file", "blob", f"{sha}:{path}", binary=True)
            blob = api("POST", f"/repos/{REPO}/git/blobs",
                       {"content": base64.b64encode(content).decode(), "encoding": "base64"})
            if blob["sha"] != ent["sha"]:
                sys.exit(f"{path} 远端 blob {blob['sha'][:8]} != 本地 {ent['sha'][:8]}")
            entries.append(ent)
            print(f"    {status} {path}  ({len(content)/1024:.0f} KB)")

        tree = api("POST", f"/repos/{REPO}/git/trees",
                   {"base_tree": parse_commit(parent)["tree"], "tree": entries})
        if tree["sha"] != c["tree"]:
            sys.exit(f"tree SHA 不符：远端 {tree['sha'][:10]} != 本地 {c['tree'][:10]}")
        print(f"    tree {tree['sha'][:10]} == 本地 ✓")

        an, ae, ad = split_identity(c["author"])
        cn, ce, cd = split_identity(c["committer"])
        new = api("POST", f"/repos/{REPO}/git/commits", {
            "message": c["message"], "tree": tree["sha"], "parents": [parent],
            "author": {"name": an, "email": ae, "date": ad},
            "committer": {"name": cn, "email": ce, "date": cd},
        })
        if new["sha"] != sha:
            sys.exit(f"commit SHA 不符：远端 {new['sha'][:10]} != 本地 {sha[:10]}")
        print(f"    commit {new['sha'][:10]} == 本地 ✓")
        parent = sha

    api("PATCH", f"/repos/{REPO}/git/refs/heads/{BRANCH}", {"sha": parent, "force": True})
    print(f"\n已更新远端 {BRANCH} -> {parent[:10]}")


if __name__ == "__main__":
    main()
