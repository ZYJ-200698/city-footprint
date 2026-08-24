# -*- coding: utf-8 -*-
"""按 Agent 宪法 14.3：提取 全局复利与踩坑日志.md 各区，覆盖同步到 Obsidian 踩坑汇总"""
import re, os

SRC = r'C:\Users\ZYJ\Documents\Agent 开发\全局复利与踩坑日志.md'
DST = r'D:\Obsidian\俊哥的 Obsidian 仓库\踩坑汇总\Codex 踩的坑.md'

src = open(SRC, encoding='utf-8-sig').read()

def section(name):
    m = re.search(r'^## ' + re.escape(name) + r'\s*$([\s\S]*?)(?=^## |\Z)', src, re.M)
    return m.group(1).strip() if m else ''

parts = ['# Codex 踩的坑（同步自 全局复利与踩坑日志.md）', '']
for name in ['踩坑记录', '可复用方法', '跳过决策']:
    body = section(name)
    if body:
        parts += ['## ' + name, '', body, '']

out = '\n'.join(parts)
open(DST, 'w', encoding='utf-8').write(out)
size = os.path.getsize(DST)
print('written bytes:', size)
assert size > 1000, '同步结果异常小，需检查'
print('sections:', [n for n in ['踩坑记录', '可复用方法', '跳过决策'] if section(n)])
