# 提醒与推送（本地 + 手机）

> 这里是**提醒**，不是同步。同步（WebDAV / CalDAV）见
> [SYNC_MANAGEMENT.md](SYNC_MANAGEMENT.md)。

## 两条独立通道

```
workspace.md 的 remind 字段
        │
        ├── 渲染进程 ReminderHost（应用内）
        │     每 30 秒检查 · 右下角弹卡片 · 稍后 10 分钟 · localStorage 去重
        │     应用没开就不提醒
        │
        └── 服务端 scheduler（推送到手机）
              后端每 30 秒检查 · 企业微信 / Server酱 / PushPlus / Bark / ntfy / Webhook
              Docker / NAS 后端常驻 → 7×24 生效
```

两者互不影响：只想要弹窗就不配渠道；想要手机收消息就配渠道。
同一条提醒可能「应用内弹 + 手机也收到」，这是预期行为。

## 数据：`remind` 字段

提醒时间存在条目上，**绝对本地时间**，不带时区后缀：

```markdown
## 产品评审
- id: 6df317aa
- kind: event
- start: 2026-11-03T10:00:00
- remind: 2026-11-03T09:30:00
```

为什么用绝对时间而不是「提前 N 分钟」：

- 全天条目 / 只有截止日的任务没有明确开始时刻
- 提前量需要隐藏规则（从 0 点算？9 点算？），用户看到的和实际触发容易对不上

界面上的「提前 30 分钟」只是输入辅助，保存时换算成绝对时间。

规则：

| 场景 | 提醒基准 |
| ---- | -------- |
| 有 start、定时 | start |
| 有 start、全天 | 当天 09:00 |
| 只有 due | 当天 09:00 |
| 都没有 | 不能设提醒 |

## 应用内提醒（默认，不需要配置）

- 全局挂载在 [`ReminderHost`](../apps/renderer/src/components/reminders/ReminderHost.tsx)
- 每 30 秒 + 窗口聚焦时检查一次
- 到点弹卡片：显示标题 / 时间 / 迟到分钟，可「稍后 10 分钟」「知道了」「打开」
- 去重：`localStorage.dsh-reminders-fired` 记「条目 id + 提醒时间」，同一提醒只弹一次
- 稍后提醒：`dsh-reminders-snoozed` 记到期时间
- 只提醒 **24 小时内**到点的；应用关太久不会一次涌出一堆过期提醒
- 已完成 / 已取消（`status: cancelled`）不提醒

桌面通知（可选）：通知页点「授权并开启」，走浏览器 / Electron 的 `Notification`；
权限被拒时应用内提醒仍然有效。

## 服务端推送（手机）

配置文件在 `config.json` 的 `notifications` 段（设置界面「通知推送」页可改）。
敏感字段（Webhook / Key / Token）读取时掩码，回传掩码不会覆盖真实值。

| 渠道 | 需要的字段 | 从哪拿 |
| ---- | ---------- | ------ |
| 企业微信机器人 | `webhookUrl` | 群 → 群机器人 → 添加 → Webhook 地址 |
| Server酱 | `sendKey` | sct.ftqq.com 登录后取 |
| PushPlus | `token` | pushplus.plus 登录后取 |
| Bark（iOS） | `serverUrl` + `deviceKey` | Bark App 里的设备 Key；官方 `https://api.day.app` |
| ntfy（可自建） | `url` + `topic`（+ 可选 `token`） | ntfy.sh 或自建实例 |
| 通用 Webhook | `url` | 自己接 n8n / 飞书 / 自建服务 |

通用 Webhook 的请求体：

```json
{
  "source": "caldav-desktop",
  "title": "产品评审",
  "body": "11-03 10:00 · 日程 · 清单：工作",
  "url": null,
  "tags": ["event"],
  "timestamp": "2026-11-02T08:00:00.000Z"
}
```

### 环境变量（Docker 友好）

```
NOTIFY_ENABLED=true
WECOM_WEBHOOK=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx
SERVERCHAN_SENDKEY=SCTxxxxx
PUSHPLUS_TOKEN=xxxx
BARK_SERVER_URL=https://api.day.app
BARK_DEVICE_KEY=xxxx
NTFY_URL=https://ntfy.sh
NTFY_TOPIC=mytopic
NTFY_TOKEN=
NOTIFY_WEBHOOK_URL=
```

填了某个渠道的 key 会自动把该渠道标记为 enabled；总开关仍是 `notifications.enabled`
（界面上的「启用服务端推送」）。

### 调度语义

- 每 30 秒检查一次 `workspace.md`（只读，不发网络请求）
- 只推 `remind <= now` 且 `now - remind <= 24h` 的
- 已完成 / 已取消不推
- 去重状态存在 workspace 同目录 `.reminder-state.json`
  （`sent` 成功记录，`failed` 失败时间）
- **任一渠道成功**就记为已推送，避免某个渠道配错导致其他渠道重复收
- 全部失败 → 5 分钟后重试；成功后 30 天内不再推同一条
- 状态文件不进 git；删掉只会让 24 小时内的提醒重新推一次

### API

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET | `/api/notifications/channels` | 渠道清单 + 是否已配置 / 启用（不含密钥） |
| GET | `/api/notifications/status` | 调度状态、待推送数、上次推送时间 |
| POST | `/api/notifications/test` | `{ channel? }` 发测试消息（指定渠道时忽略 enabled） |
| POST | `/api/notifications/check` | 立即检查并推送一次（调试） |

配置本身走 `/api/config` 的 `notifications` 段。

## 安全

- 密钥只存在后端 `config.json`，`GET /api/config` 返回掩码
- 不要把带密钥的 `config.json` 提交到 git（已在 `.gitignore`）
- 后端目前**没有内置登录**。如果要暴露到公网，请放在反向代理 / Tailscale /
  Cloudflare Access 后面，或只在内网使用

## 已知限制

- 应用内提醒需要应用运行；手机推送需要后端运行（Docker / NAS 常驻最省心）
- 不支持「按条目选择渠道」：所有启用的渠道都会收到所有提醒
- 不支持重复提醒（每隔 N 分钟提醒一次）、不支持日历级默认提醒
- 重复事件的提醒按主事件设置，例外实例（RECURRENCE-ID）不单独提醒
- **多后端部署时只在一处开启推送**：桌面版后端和 Docker 后端如果各有一份
  workspace.md（即使通过 WebDAV 同步），两边都会各自调度并推送 → 同一条提醒收两次
