#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
今日热榜 · 多平台热榜抓取脚本（方案 A：纯静态站点的实时数据源）

用法：
    python3 tools/fetch_hotlist.py

说明：
    - 使用 Python 标准库，无需安装任何第三方依赖
    - 聚合 微博 / 头条 / B站 / 百度 四个公开接口
    - 各平台相互独立：单个平台失败不影响其他平台
    - 输出 data/hotlist.json，前端会定时拉取并刷新「今日热榜速览」
    - 各平台热度单位不同，脚本不做跨平台统一排名（与博客方法论一致）

可放到系统的定时任务里实现自动更新，例如每 10 分钟一次：
    */10 * * * * cd /你的站点目录 && python3 tools/fetch_hotlist.py
"""

import json
import os
import datetime
import urllib.request
import urllib.parse

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
TIMEOUT = 12

# 抓取到的四平台累计条数上限（用于「今日热榜速览」面板）
PER_SOURCE = 15


def http_get(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return resp.read().decode("utf-8", "ignore")


def fetch_weibo():
    data = json.loads(http_get(
        "https://weibo.com/ajax/side/hotSearch",
        {"User-Agent": UA, "Referer": "https://weibo.com/"}))
    rows = data["data"]["realtime"]
    out = []
    for i, it in enumerate(rows, 1):
        w = it.get("word", "")
        if not w:
            continue
        out.append({
            "rank": i,
            "title": w,
            "source": "微博",
            "heat": str(it.get("num", "")),
            "url": "https://s.weibo.com/weibo?q=" + urllib.parse.quote(w),
        })
    return out


def fetch_toutiao():
    data = json.loads(http_get(
        "https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc",
        {"User-Agent": UA, "Referer": "https://www.toutiao.com/"}))
    out = []
    for i, it in enumerate(data.get("data", []), 1):
        out.append({
            "rank": i,
            "title": it.get("Title", ""),
            "source": "头条",
            "heat": str(it.get("HotValue", "")),
            "url": it.get("Url") or "https://www.toutiao.com/",
        })
    return out


def fetch_bilibili():
    data = json.loads(http_get(
        "https://api.bilibili.com/x/web-interface/popular?ps=20&pn=1",
        {"User-Agent": UA, "Referer": "https://www.bilibili.com/"}))
    out = []
    for i, it in enumerate(data["data"]["list"], 1):
        out.append({
            "rank": i,
            "title": it.get("title", ""),
            "source": "B站",
            "heat": str(it.get("stat", {}).get("view", "")),
            "url": "https://www.bilibili.com/video/" + it.get("bvid", ""),
        })
    return out


def fetch_baidu():
    data = json.loads(http_get(
        "https://top.baidu.com/api/board?platform=wise&tab=realtime",
        {"User-Agent": UA, "Referer": "https://top.baidu.com/"}))
    try:
        rows = data["data"]["cards"][0]["content"][0]["content"]
    except (KeyError, IndexError, TypeError):
        return []
    out = []
    for i, it in enumerate(rows, 1):
        w = it.get("word") or it.get("query") or ""
        if not w:
            continue
        out.append({
            "rank": i,
            "title": w,
            "source": "百度",
            "heat": str(it.get("hotScore", "")),
            "url": it.get("url") or "https://www.baidu.com/s?wd=" + urllib.parse.quote(w),
        })
    return out


SOURCES = [
    ("微博", fetch_weibo),
    ("头条", fetch_toutiao),
    ("B站", fetch_bilibili),
    ("百度", fetch_baidu),
]

# ---------- 路径与留存策略 ----------
DATA_DIR = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data"))
OUT_PATH = os.path.join(DATA_DIR, "hotlist.json")
TRACK_PATH = os.path.join(DATA_DIR, "hottrack.json")
SNAPSHOT_DIR = os.path.join(DATA_DIR, "snapshots")

KEEP_SNAPSHOT_DAYS = 3   # 快照保留天数，超出自动清理
TRACK_TTL_HOURS = 36     # 词条超过该时长未再出现则移出追踪表


def parse_dt(s):
    try:
        return datetime.datetime.strptime(s, "%Y-%m-%d %H:%M")
    except Exception:
        return None


def load_prev():
    """读取上一次抓取结果，构造 (来源, 标题) -> 上次排名 的映射，用于计算升降"""
    try:
        with open(OUT_PATH, encoding="utf-8") as f:
            old = json.load(f)
        return {(i.get("source", ""), i.get("title", "")): i.get("rank")
                for i in old.get("items", [])}
    except Exception:
        return {}


def load_track():
    """跨会话词条追踪表：记录首次上榜、最近上榜、上榜次数与最高排名"""
    try:
        with open(TRACK_PATH, encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict) and isinstance(data.get("tracks"), dict):
            return data
    except Exception:
        pass
    return {"since": None, "crawls": 0, "tracks": {}}


def save_track(track):
    with open(TRACK_PATH, "w", encoding="utf-8") as f:
        json.dump(track, f, ensure_ascii=False, indent=2)


def prune_tracks(tracks, now):
    """清理已长时间不再出现的词条，避免追踪表无限增长"""
    cutoff = now - datetime.timedelta(hours=TRACK_TTL_HOURS)
    dead = []
    for title, t in tracks.items():
        last = parse_dt(t.get("last", ""))
        if last is not None and last < cutoff:
            dead.append(title)
    for title in dead:
        tracks.pop(title, None)
    return len(dead)


def archive_snapshot(payload, now):
    """归档本次快照（便于日后回看历史热榜），并清理过期文件"""
    try:
        os.makedirs(SNAPSHOT_DIR, exist_ok=True)
        name = now.strftime("%Y-%m-%d_%H%M") + ".json"
        with open(os.path.join(SNAPSHOT_DIR, name), "w", encoding="utf-8") as f:
            json.dump({
                "time": now.strftime("%Y-%m-%d %H:%M"),
                "sources": payload["sources"],
                "items": [{k: i[k] for k in ("rank", "title", "source", "heat", "url") if k in i}
                          for i in payload["items"]],
            }, f, ensure_ascii=False, indent=2)
        # 清理过期快照
        cutoff = (now - datetime.timedelta(days=KEEP_SNAPSHOT_DAYS)).strftime("%Y-%m-%d")
        for f in os.listdir(SNAPSHOT_DIR):
            if f[:10] < cutoff:
                try:
                    os.remove(os.path.join(SNAPSHOT_DIR, f))
                except OSError:
                    pass
        return name
    except OSError as exc:
        print("[跳过] 快照归档失败：%s" % exc)
        return None


def main():
    now = datetime.datetime.now()
    stamp = now.strftime("%Y-%m-%d %H:%M")

    prev = load_prev()
    track = load_track()
    tracks = track["tracks"]
    if not track.get("since"):
        track["since"] = stamp
    track["crawls"] = track.get("crawls", 0) + 1

    items, sources = [], []
    for name, fn in SOURCES:
        try:
            rows = fn()[:PER_SOURCE]
            if rows:
                sources.append(name)
                items.extend(rows)
                print("[OK]   %-4s 抓到 %2d 条" % (name, len(rows)))
            else:
                print("[空]   %-4s 返回为空" % name)
        except Exception as exc:  # 单源失败不影响整体
            print("[失败] %-4s %s" % (name, exc))

    # 关键保护：全部源失败时保留上一次结果，避免把已有数据覆盖成空
    if not items:
        print("-" * 44)
        print("[跳过] 本次未抓到任何数据，保留上一次结果不写入。")
        return

    # 附加升降趋势与在榜轨迹
    for it in items:
        title = it.get("title", "")
        old_rank = prev.get((it.get("source", ""), title))
        it["prev"] = old_rank
        it["delta"] = (old_rank - it["rank"]) if isinstance(old_rank, int) else 0
        it["isNew"] = old_rank is None

        t = tracks.get(title) or {"first": "", "last": "", "hits": 0, "best": 999,
                                  "source": it.get("source", "")}
        if not t.get("first"):
            t["first"] = stamp
        t["last"] = stamp
        t["hits"] = t.get("hits", 0) + 1
        t["best"] = min(t.get("best", 999), it["rank"])
        t["source"] = it.get("source", "")
        tracks[title] = t
        it["track"] = {"first": t["first"], "hits": t["hits"], "best": t["best"]}

    source_count = {}
    for it in items:
        source_count[it["source"]] = source_count.get(it["source"], 0) + 1

    stats = {
        "total": len(items),
        "newCount": sum(1 for i in items if i.get("isNew")),
        "upCount": sum(1 for i in items if i.get("delta", 0) > 0),
        "downCount": sum(1 for i in items if i.get("delta", 0) < 0),
        "sources": source_count,
        "crawls": track["crawls"],
        "since": track["since"],
        "tracked": len(tracks),
    }

    payload = {
        "updatedAt": stamp,
        "snapshotDate": now.strftime("%Y-%m-%d"),
        "sources": sources,
        "items": items,
        "stats": stats,
    }

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    removed = prune_tracks(tracks, now)
    save_track(track)
    snap = archive_snapshot(payload, now)

    print("-" * 44)
    print("已写入 %s，共 %d 条（来源：%s）" %
          (OUT_PATH, len(items), " / ".join(sources) or "无"))
    print("趋势：新增 %d 条 / 上升 %d 条 / 下降 %d 条" %
          (stats["newCount"], stats["upCount"], stats["downCount"]))
    print("追踪池：%d 个词条（清理过期 %d 个）｜累计抓取 %d 次，起始 %s" %
          (len(tracks), removed, track["crawls"], track["since"]))
    if snap:
        print("已归档快照：snapshots/%s" % snap)


if __name__ == "__main__":
    main()
