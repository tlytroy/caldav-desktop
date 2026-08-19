#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
parse_kanban.py — 工作搭子看板 .md → 任务对象 → ICS → (可选) CalDAV

纯标准库实现，无第三方依赖，断网可跑。
这是「Markdown 作为数据层」模式的参考 bridge：读唯一事实源(md)，
把未完成任务搬到你的 CalDAV 日历。

用法:
  # 仅解析并打印(JSON)
  python3 parse_kanban.py 工作搭子看板.md

  # 生成 ICS 文件
  python3 parse_kanban.py 工作搭子看板.md --ics out.ics

  # 直接 PUT 到 CalDAV (需要系统里有 curl)
  export CALDAV_PASS='xxxx'
  python3 parse_kanban.py 工作搭子看板.md \
      --push --url "https://your-caldav/calendars/user/tasks/" \
      --user yourname
"""

import re
import sys
import json
import uuid
import argparse
import subprocess
import datetime
import os
import tempfile

PRIO_TO_ICAL = {"高": "1", "中": "5", "低": "9"}  # iCal PRIORITY: 1最高, 9最低


# ---------------------------------------------------------------------------
# 1. 解析 md -> 任务对象  (严格按 开发指南.md 第 3 节 grammar)
# ---------------------------------------------------------------------------
def parse_kanban(path):
    tasks, projects, notes = [], [], []
    cur, section = None, ""
    with open(path, encoding="utf-8") as f:
        lines = f.read().splitlines()

    for raw in lines:
        line = raw.strip()
        if line.startswith("## "):
            section = line[3:].strip()
            cur = None
            continue
        if section == "待办":
            m = re.match(r"^-\s*\[([ xX])\]\s*\[([高低中])\]\s*(.+)$", line)
            if m:
                done = m[1].lower() == "x"
                prio = m[2]
                rest = m[3]
                text = rest.split("|")[0].strip()
                fields = {}
                for part in rest.split("|")[1:]:
                    if ":" in part:
                        k, v = part.split(":", 1)
                        fields[k.strip()] = v.strip()
                tasks.append({
                    "text": text,
                    "priority": prio,
                    "done": done,
                    "due": fields.get("截止", ""),
                    "est": fields.get("预估", ""),
                    "project": fields.get("项目", ""),
                    "postponed": int(fields.get("顺延", "0") or 0),
                    "done_at": fields.get("完成", ""),
                })
        elif section == "项目":
            if line.startswith("### "):
                cur = {"name": line[4:].strip(), "current": "", "next": "", "blocked": "", "linked": []}
                projects.append(cur)
            elif cur:
                if line.startswith("当前："):
                    cur["current"] = line[3:].strip()
                elif line.startswith("下一步："):
                    cur["next"] = line[4:].strip()
                elif line.startswith("卡点："):
                    v = line[3:].strip()
                    cur["blocked"] = "" if v in ("无", "") else v
                elif line.startswith("关联："):
                    v = line[3:].strip()
                    cur["linked"] = [] if v in ("（无）", "") else [s.strip() for s in v.split(",")]
        elif section == "速记" and line.startswith("- "):
            body = line[2:]
            tags = re.findall(r"#([^\s#]+)", body)
            txt = re.sub(r"#([^\s#]+)", "", body).strip()
            if txt:
                notes.append({"text": txt, "tags": tags})
    return {"tasks": tasks, "projects": projects, "notes": notes}


# ---------------------------------------------------------------------------
# 2. 任务对象 -> 单条 VTODO (ICS)
# ---------------------------------------------------------------------------
def task_to_vtodo(task):
    # 稳定 UID：同一任务重跑覆盖同一文件，不会重复创建
    uid = uuid.uuid5(uuid.NAMESPACE_URL, "kanban/" + task["text"]).hex
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    due = task["due"].replace("-", "") if task["due"] else ""
    lines = [
        "BEGIN:VTODO",
        f"UID:{uid}",
        f"SUMMARY:{task['text']}",
        f"PRIORITY:{PRIO_TO_ICAL.get(task['priority'], '5')}",
    ]
    if due:
        lines.append(f"DUE;VALUE=DATE:{due}")
    if task["project"]:
        lines.append(f"CATEGORIES:{task['project']}")
    if task["est"]:
        # iCal 没有标准工时字段，用 X- 扩展保留
        lines.append(f"X-EST-HOURS:{task['est']}")
    lines += [
        "STATUS:NEEDS-ACTION",
        f"CREATED:{now}",
        "END:VTODO",
    ]
    return "\r\n".join(lines) + "\r\n", uid


def build_ics(data):
    out = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//work-dazi//kanban-bridge//CN",
        "CALSCALE:GREGORIAN",
    ]
    for t in data["tasks"]:
        if t["done"] or not t["due"]:
            continue  # 只同步「未完成且有截止日」的任务
        vtodo, _ = task_to_vtodo(t)
        out.append(vtodo.rstrip("\r\n"))
    out.append("END:VCALENDAR")
    return "\r\n".join(out) + "\r\n"


# ---------------------------------------------------------------------------
# 3. (可选) PUT 到 CalDAV
# ---------------------------------------------------------------------------
def push_caldav(data, url, user, password):
    if not url.endswith("/"):
        url += "/"
    ok = 0
    for t in data["tasks"]:
        if t["done"] or not t["due"]:
            continue
        vtodo, uid = task_to_vtodo(t)
        target = url + uid + ".ics"
        # 用临时文件承载，避免命令行注入 + 中文编码问题
        fd, tmp = tempfile.mkstemp(suffix=".ics")
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(vtodo)
        cmd = [
            "curl", "-sS", "-u", f"{user}:{password}",
            "-X", "PUT", target,
            "-H", "Content-Type: text/calendar; charset=utf-8",
            "--data-binary", f"@{tmp}",
        ]
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            if r.returncode == 0:
                ok += 1
                print(f"  [OK] {t['text']} -> {uid}.ics")
            else:
                print(f"  [FAIL] {t['text']}: {r.stderr.strip()}", file=sys.stderr)
        except Exception as e:
            print(f"  [ERR] {t['text']}: {e}", file=sys.stderr)
        finally:
            os.remove(tmp)
    print(f"推送到 CalDAV 完成：{ok} 条未完成任务。")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="工作搭子看板 md -> CalDAV 参考解析器")
    ap.add_argument("kanban", help="工作搭子看板.md 路径")
    ap.add_argument("--ics", metavar="FILE", help="输出 ICS 文件")
    ap.add_argument("--push", action="store_true", help="推送到 CalDAV")
    ap.add_argument("--url", help="CalDAV 日历集合 URL (PUT 目标)")
    ap.add_argument("--user", help="CalDAV 用户名")
    ap.add_argument("--pass", dest="password", help="CalDAV 密码(或用环境变量 CALDAV_PASS)")
    args = ap.parse_args()

    data = parse_kanban(args.kanban)

    if not args.ics and not args.push:
        # 默认：打印解析结果
        print(json.dumps(data, ensure_ascii=False, indent=2))
        return

    if args.ics:
        with open(args.ics, "w", encoding="utf-8") as f:
            f.write(build_ics(data))
        print(f"已生成 ICS：{args.ics}（含 {sum(1 for t in data['tasks'] if not t['done'] and t['due'])} 条未完成任务）")

    if args.push:
        if not (args.url and args.user):
            print("错误：--push 需要 --url 和 --user", file=sys.stderr)
            sys.exit(1)
        pw = args.password or os.environ.get("CALDAV_PASS", "")
        if not pw:
            print("错误：未提供 CalDAV 密码（--pass 或环境变量 CALDAV_PASS）", file=sys.stderr)
            sys.exit(1)
        print("开始推送到 CalDAV ...")
        push_caldav(data, args.url, args.user, pw)


if __name__ == "__main__":
    main()
