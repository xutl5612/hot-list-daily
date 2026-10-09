#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把站点打包成「单文件版」：全部 CSS / JS / 数据 内联进一个 HTML。

用途：通过聊天工具把单个 .html 文件发到手机/电脑即可完整打开，
     不依赖同目录的 assets/ 与 data/ 文件夹。

用法：
    python3 tools/build_standalone.py
输出：
    今日热榜-单文件版.html（位于站点根目录）

说明：
    - 每次修改文章或样式后重新运行本脚本即可更新单文件版
    - 单文件版内置数据快照（data/hotlist.js），实时热榜需通过
      本地服务 + tools/fetch_hotlist.py 使用完整目录版
"""

import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
SRC = os.path.join(ROOT, "index.html")
OUT = os.path.join(ROOT, "今日热榜-单文件版.html")


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def inline_css(m):
    href = m.group(1)
    css = read(os.path.join(ROOT, href))
    return "<style>\n" + css + "\n</style>"


def inline_js(m):
    src = m.group(1)
    code = read(os.path.join(ROOT, src))
    # 防止 JS 内容中出现 </script> 提前闭合标签（字符串中 \/ 等价于 /）
    code = code.replace("</script", "<\\/script")
    return "<script>\n" + code + "\n</script>"


def main():
    html = read(SRC)
    html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', inline_css, html)
    html = re.sub(r'<script src="([^"]+)"></script>', inline_js, html)

    leftover = re.findall(r'(?:href|src)="(?:assets|data)/[^"]*"', html)
    if leftover:
        print("[警告] 仍有未内联的外部引用：%s" % leftover)

    with open(OUT, "w", encoding="utf-8") as f:
        f.write(html)
    print("已生成 %s（%d KB）" % (OUT, os.path.getsize(OUT) // 1024))


if __name__ == "__main__":
    main()
