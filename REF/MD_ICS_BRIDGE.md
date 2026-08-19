# MD ↔ ICS 桥接方案设计（重构版）

## 核心思路：MD 文件即缓存，编辑即本地，同步即转换

### 核心原则

1. **一个专门的 MD 文件作为所有日历事件的本地缓存** — `events.md` 是唯一的真实数据源（SSOT）
2. **编辑操作全在本地 MD 文件上进行** — 增/删/改事件都直接修改这个 MD 文件的 YAML frontmatter
3. **ICS 是同步时的导出格式** — 仅在需要同步到 CalDAV 服务器时才将 MD 转换为 ICS
4. **WebDAV 可直接同步 MD 文件本身** — 不搭建 CalDAV 也能通过同步 `events.md` 实现多设备
5. **AI 友好** — AI 助手指需要读写一个结构化的 MD 文件，无需理解 ICS 协议

```
┌─────────────────────────────────────────────────────────────────────┐
│                         events.md（唯一数据源）                        │
│                                                                     │
│  ---                                                                 │
│  # 文件格式：YAML frontmatter 中包含所有日历事件                        │
│  events:                                                             │
│    - uid: "uuid-1"                                                   │
│      title: "项目评审会议"                                            │
│      date: "2026-08-18T14:00:00"                                     │
│      end: "2026-08-18T15:30:00"                                      │
│      allDay: false                                                   │
│      status: confirmed                                               │
│      category: "工作"                                                │
│      tags: ["项目", "评审"]                                          │
│      recurrence: "weekly"                                            │
│      description: "项目进度评审会议"                                   │
│      updated: "2026-08-18T10:00:00Z"                                 │
│    - uid: "uuid-2"                                                   │
│      title: "更新项目计划"                                            │
│      date: "2026-08-20"                                              │
│      allDay: true                                                    │
│      status: needs-action                                            │
│      category: "个人"                                                │
│      tags: ["待办"]                                                  │
│      description: "张三：更新项目计划"                                 │
│      updated: "2026-08-18T10:00:00Z"                                 │
│  ---                                                                 │
│                                                                     │
│  # 正文部分：AI 可以写入任何上下文信息                                  │
│  ## 2026-08-18 项目评审会议                                           │
│  - 张三汇报了项目进度，当前完成 80%                                    │
│  - 李四提出了技术方案调整建议                                          │
│  - 决定下周三再做一次评审                                              │
│                                                                     │
└──────────────────────────────────────────────────────────────────────┘
         │                        │
         ▼                        ▼
┌─────────────────┐    ┌──────────────────────┐
│  同步到 CalDAV   │    │  同步到 WebDAV（可选） │
│  MD → ICS 转换   │    │  直接同步 events.md   │
│  PUT .ics 文件   │    │  无需 ICS 转换        │
└─────────────────┘    └──────────────────────┘
```

## 文件格式规范

### events.md 结构

```
---
events:
  - uid: "string"            # 唯一标识，自动生成或保留
    title: "string"           # 事件标题（必填）
    date: "ISO 8601"          # 开始日期/时间（必填）
    end: "ISO 8601"           # 结束日期/时间
    allDay: boolean           # 是否全天事件
    status: "confirmed" | "tentative" | "cancelled" | "needs-action"
    category: "string"        # 分类
    tags: ["string"]          # 标签列表
    recurrence: "daily" | "weekly" | "monthly" | "yearly"
    description: "string"     # 描述/备注
    updated: "ISO 8601"       # 最后更新时间
    source: "caldav" | "md" | "ai"  # 来源标记
  - ...
---
```

### 设计理由

| 特性                 | 说明                                                |
| -------------------- | --------------------------------------------------- |
| **单一文件**         | 避免碎片化，方便 WebDAV 同步，AI 只需要处理一个文件 |
| **YAML frontmatter** | 标准的 Markdown 元数据格式，所有编辑器/渲染器都支持 |
| **events 数组**      | 一个文件可容纳所有事件，结构清晰                    |
| **正文部分**         | 可自由写入会议纪要、笔记等，AI 可从中提取新事件     |
| **updated 字段**     | 用于冲突检测和增量同步                              |

## 同步策略

### 方式一：CalDAV 同步（主力）

```
编辑 events.md
    │
    ▼
用户点击"同步" / 定时自动同步
    │
    ▼
读取 events.md 的 frontmatter
    │
    ▼
遍历 events[] 数组
    │
    ├── 新增事件（无 uid 或 source="md"）
    │   → 生成 UID
    │   → 转换为 ICS
    │   → PUT 到 CalDAV 服务器
    │   → 更新 events.md 中的 uid 和 source="caldav"
    │
    ├── 修改事件（updated 比上次同步新）
    │   → 转换为 ICS
    │   → PUT 更新 CalDAV 服务器
    │
    └── 删除事件（标记 deleted 或从 events 移除）
        → DELETE CalDAV 上的 .ics 文件
```

### 方式二：WebDAV 直接同步（无 CalDAV 场景）

```
无需 ICS 转换，直接同步 events.md 文件本身

本地 events.md  ←→  WebDAV 服务器 /remote/events.md
                        │
                  其他设备同步后
                  读取 events.md 即可
```

**优势**：

- 不需要搭建 CalDAV 服务器
- 不需要 ICS 转换逻辑
- 文件级同步，简单可靠
- 任何支持 WebDAV 的云盘（Nextcloud、ownCloud、Box 等）均可

### 方式三：Git 同步（高级场景）

```
本地 events.md  ←→  Git 仓库（GitHub/GitLab）
                        │
                  利用 Git 的历史记录和冲突解决
                  PR 方式审核 AI 的修改
```

## 与 AI 助手的协同

### AI 读取数据

```markdown
AI 读取 events.md → 解析 YAML frontmatter → 获得完整的事件列表
→ 可作为上下文用于回答"我今天有什么安排"等查询
```

### AI 写入数据

```markdown
AI 解析用户会议纪要 → 提取事件信息
→ 追加到 events.md 的 events[] 数组
→ 用户确认后触发同步
```

### AI 格式示例

```markdown
---
events:
  - title: "项目评审会议"
    date: "2026-08-18T14:00:00"
    end: "2026-08-18T15:30:00"
    category: "工作"
    tags: ["项目"]
    description: "AI 从会议纪要中自动提取"
    source: "ai"
---
```

## 服务器端 API（简化版）

### 核心接口

| 方法   | 路径                         | 说明                                    |
| ------ | ---------------------------- | --------------------------------------- |
| `GET`  | `/api/md-bridge/events`      | 读取 events.md 返回所有事件             |
| `PUT`  | `/api/md-bridge/events`      | 写入完整 events.md（AI/用户编辑后保存） |
| `POST` | `/api/md-bridge/sync/caldav` | 将 events.md 同步到 CalDAV              |
| `POST` | `/api/md-bridge/sync/webdav` | 将 events.md 同步到 WebDAV              |
| `GET`  | `/api/md-bridge/config`      | 读取同步配置                            |
| `PUT`  | `/api/md-bridge/config`      | 更新同步配置                            |

### 数据流

```
前端 / AI
   │
   │  PUT /api/md-bridge/events  (写入 events.md)
   ▼
events.md 文件（服务器端缓存）
   │
   │  POST /api/md-bridge/sync/caldav
   ▼
MD → ICS 转换 → CalDAV PUT
```

## 实现计划

### 第一阶段：核心文件格式与编辑（当前）

- [x] `events.md` 格式定义
- [x] MD frontmatter 解析（支持 events 数组）
- [ ] MD frontmatter 写入（追加/更新/删除事件）
- [ ] `GET/PUT /api/md-bridge/events` API

### 第二阶段：CalDAV 同步

- [ ] events.md → ICS 批量转换
- [ ] 增量同步（只推送修改过的事件）
- [ ] 冲突检测（基于 updated 时间戳）
- [ ] 双向同步（从 CalDAV 拉取更新 events.md）

### 第三阶段：WebDAV 同步

- [ ] WebDAV 配置界面
- [ ] events.md 上传/下载
- [ ] 定时自动同步

### 第四阶段：AI 集成

- [ ] AI 读取 events.md 作为上下文
- [ ] AI 写入新事件到 events.md
- [ ] AI 编辑现有事件
- [ ] AI 自动触发同步
