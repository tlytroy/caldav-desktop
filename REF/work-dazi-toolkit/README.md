# 工作搭子工具箱 (work-dazi-toolkit)

一套「**Markdown 当唯一事实源**」的个人效率工具：前端录入 + AI Agent 排计划 + 定时脚本搬去日历。
核心思想见 [开发指南.md](开发指南.md)，拿来借鉴到你的 CalDAV 日历工具完全没问题。

## 包含什么

| 文件 | 作用 |
|------|------|
| `工作台.html` | 单文件离线前端：今天待办 / 灵感速记 / 项目跟进 / 每周复盘；localStorage 自动保存；可导出/导入 JSON；与看板双向同步 |
| `work-dazi/` | 「工作搭子」AI Agent 定义（WorkBuddy 专家），负责把自然语言消息变成结构化任务、排优先级、每日提醒 |
| `samples/工作搭子看板.md` | 互通格式的示例看板，同时当 parser 的测试夹具 |
| `scripts/parse_kanban.py` | 参考解析器：看板 md → 任务对象 → ICS → (可选) CalDAV PUT，纯标准库 |
| `开发指南.md` | 架构说明 + 格式规范 + 三种集成模式 + 踩坑与最佳实践 |

## 30 秒上手

1. **用前端**：双击 `工作台.html`，浏览器打开即用（断网可用）。
2. **看 Agent 怎么干活**：在 WorkBuddy 专家中心导入 `work-dazi/`，随手发消息给它。
3. **搬到日历**：
   ```bash
   python3 scripts/parse_kanban.py samples/工作搭子看板.md --ics out.ics   # 先看效果
   export CALDAV_PASS='xxxx'
   python3 scripts/parse_kanban.py 工作搭子看板.md \
       --push --url "https://你的CalDAV/calendars/user/tasks/" --user 你的账号
   ```

## 数据流

```
随手记/自然语言 ─► 工作搭子看板.md(唯一事实源) ─► parse_kanban.py ─► CalDAV
    (工作台 / AI)          ▲                                  (你的日历工具)
                           └──────── 双向同步按钮 / 手动 / cron ──┘
```

## 设计原则（想借鉴时记住这几点）

- **一份 md 当总线**，所有角色都读写它，不各自存私货。
- **决策与执行解耦**：Agent 决定写什么，脚本负责搬到哪。
- **稳定 UID 保证幂等**：重跑解析器不会在日历里造出重复任务。
- **离线优先 + 零依赖**：前端单文件、解析器纯标准库。

详见 [开发指南.md](开发指南.md)。
