# 同步通道说明（WebDAV / CalDAV）

> **2026-11-02 重写。** 上一版描述的是「`events.md` + `工作搭子看板.md` 两个文件」
> 同步，以及一套基于 `localStorage` 的缓存方案 —— **两者都已不存在**。
> 现在同步的对象只有一个文件：`workspace.md`。

## 一句话总览

```
                    workspace.md（唯一事实源，本地）
                            │
              ┌─────────────┴─────────────┐
              │                           │
     WebDAV 通道（文件原样）        CalDAV 通道（转 ICS）
              │                           │
     Nextcloud / 坚果云 / NAS       Radicale / 其他日历服务
```

两条通道**都是可选的**。连不上、配错了、服务器关了，本地功能完全不受影响 ——
服务端启动时不再阻塞等待 CalDAV 探测（先 `listen`，再后台探测）。

### 本地优先是硬约束

- 所有编辑（日历 / 看板 / 快速创建 / 设置）只写本地 `workspace.md`
- 同步状态接口 `/api/caldav/status` **不发网络请求**，服务器关着也能正常显示
- 同步失败只影响「这一次同步」，不会回滚或阻塞本地操作
- 读接口（状态 / 日历列表）在服务器不可用时返回 `degraded`，不返回 500
- 同步接口（push / pull）失败必须明确报错，不能假装成功

## WebDAV 通道（推荐，已完整可用）

直接把 `workspace.md` 传到 WebDAV 服务器，**不做任何格式转换**，md 格式跨设备无损。

### 配置（项目根目录 `.env` 或设置界面）

```
WEBDAV_URL=https://dav.example.com/remote.php/dav/files/user
WEBDAV_USER=your_username
WEBDAV_PASS=your_password
WEBDAV_EVENTS_PATH=CalDAV-Desktop          # 只取目录部分
WEBDAV_TIMEOUT_MS=20000
```

> `WEBDAV_EVENTS_PATH` 的**文件名部分会被忽略**（历史遗留的变量名）。
> 远端固定使用 `workspace.md` 这个文件名。
> 旧写法 `WEBDAV_EVENTS_PATH=CalDAV-Desktop/events.md` 仍可用 —— 目录照样解析成
> `CalDAV-Desktop`，但文件是 workspace.md。

### 数据安全设计

| 机制 | 说明 |
| ---- | ---- |
| ETag 乐观锁 | push 时比对本地记录的 ETag 与远端当前 ETag；不一致说明别处改过，**返回 conflict 且不覆盖** |
| 拉取保护 | 远端 ETag 没变就跳过，避免冲掉未同步的本地修改 |
| 覆盖前备份 | pull 覆盖前把本地文件复制为 `.bak` |
| 状态记录 | 同目录 `.webdav-state.json` 记各文件上次同步的 ETag 与时间 |

冲突时 UI 给三个明确选项：

1. **以本地为准**：force push，用本地文件覆盖远端
2. **以远端为准**：force pull，用远端文件覆盖本地
3. **合并双方条目**：按 id 取并集 —— 两边独有的都保留；同一条目用 `updatedAt`
   较新的一版；时间相同但内容不同 → 保留本地并报告冲突。
   合并结果两端写同一份；先带 `If-Match` 推远端，成功后才写本地，
   期间远端又被改则返回 409、本地不动。本地覆盖前备份 `.bak`。

条目级合并的已知边界：**删除不参与合并** —— 一边删掉的条目会被并集「复活」。
需要删除时，先合并完，再在两端都删一次。

### API

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET | `/api/webdav/status` | 配置 + 本地/远端状态 + 上次同步时间 + 远端是否变更 |
| POST | `/api/webdav/push` | 推送；`files` 限定范围、`force` 强制覆盖 |
| POST | `/api/webdav/pull` | 拉取；`force` 强制覆盖本地 |
| POST | `/api/webdav/merge` | 条目级合并（冲突三选一里的「合并」） |
| POST | `/api/webdav/test` | 连通性与认证测试 |

`files` 的取值当前只有一个：`["workspace"]`（旧值 `events` / `kanban` 已在 P3 删除，
传了会被当成未知 key）。**不传 = 全部**。

### 实现说明

只用 Node 内置 `fetch` + `PROPFIND` / `MKCOL` / `PUT` / `GET` / `HEAD`，
不引第三方 WebDAV 库 —— 坚果云等服务商对第三方库的兼容性参差，直接发原始请求最稳。
实现文件：`apps/server/src/routes/webdav.ts`（前端面板在日历页工具栏「WebDAV」）。

## CalDAV 通道（已切到 workspace.md）

### 它做什么

把 `workspace.md` 里**有 `start` 的条目**转成 VEVENT，逐对象推到日历服务器；
拉取时反过来，把远端事件合并回同一个文件。

```
workspace.md 条目  ──ics-convert──▶  单个 VEVENT  ──PUT──▶  CalDAV
      ▲                                                       │
      └──────────── 合并（保留 uid / 本地字段）◀──GET─────────┘
```

实现：`apps/server/src/caldav-sync.ts`（同步引擎）+ `routes/caldav-sync.ts`（HTTP）。
前端入口在日历页工具栏（推送 CalDAV / 拉取 / 双向同步）。
旧 `/api/md-bridge/sync/caldav` 已在 P3 随双文件架构一起删除（D19/D29）。

### 关键机制

| 机制 | 说明 |
| ---- | ---- |
| UID 落盘 | 拉来的事件把远端 UID 写进条目 `uid`。否则本地改完推回去会在服务器上**新建**，手机日历里出现重复日程 |
| 逐对象 ETag | PROPFIND 拿 href + ETag；ETag 与状态文件一致的对象**不下载**（增量拉取） |
| 字段指纹 | 状态文件记录上次同步时参与同步的字段（标题/时间/标签/优先级…）的指纹，用来判断「本地改没改」 |
| 乐观锁 | 推送带 `If-Match`；远端在同步间隙被别的设备改过 → 412，转为冲突而不是覆盖 |
| 冲突不静默 | 两边都改过时**保留本地**并返回 `conflicts[]`，界面给三个按钮：以远端为准 / 以本地为准 / **字段级合并**；force 只作用于这批 UID，不会连带覆盖其它条目 |
| 字段级合并 | 逐字段三方比较：只有远端改的用远端，只有本地改的保留，两边都改的保留本地并在 `merged[].conflictFields` 里列出字段名；合并结果再推回远端 |
| 跳过例外实例 | `RECURRENCE-ID` 的例外实例不参与合并（会把主事件改成「只剩一天」） |
| 状态文件 | 与 workspace.md 同目录的 `.caldav-sync-state.json`（不进 git；丢了只是下次全量重拉，不会丢数据） |
| 并发保护 | 手动同步与自动同步撞车时复用同一个 Promise，不会重复 PUT |

### 配置

```
CALDAV_ROOT_URL=https://your-server/
CALDAV_USER=your_username
CALDAV_PASS=your_password
CALDAV_CALENDAR_URL=            # 可选；留空 = 自动发现第一个日历
CALDAV_TIMEOUT_MS=15000
MD_ICS_SYNC_DIRECTION=bidirectional   # push | pull | bidirectional
MD_ICS_AUTO_SYNC_MINUTES=0            # 0 = 仅手动
```

`MD_ICS_SYNC_DIRECTION` 还兼容 `md-to-caldav` / `caldav-to-md` / `both` 旧写法，
内部经 `normalizeDirection()` 归一化。

> `MD_ICS_ENABLED` 不再被读取：自动同步只看 `MD_ICS_AUTO_SYNC_MINUTES`
> （> 0 才启用）。旧配置留着也不会报错。

设置界面「同步 → CalDAV」可直接填地址 / 账号 / 日历 URL；点「读取日历列表」
从服务器拉取日历供选择。改完立即生效（`config.json` 优先于环境变量）。

### 自动同步

`MD_ICS_AUTO_SYNC_MINUTES > 0` 时，进程内每 60 秒检查一次「距上次自动同步
是否已超过配置间隔」，超过才真正同步。所以**改间隔不用重启**；设为 0 等于关闭。
同步在后台执行，失败只写日志，不影响本地使用。

### API

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET | `/api/caldav/status` | 配置 + 上次同步 + 待推送条数（**不发网络请求**） |
| GET | `/api/caldav/calendars` | 日历列表（服务器不可用时 200 + `degraded`；自动发现失败但配了 `CALDAV_CALENDAR_URL` 时退回该 URL） |
| POST | `/api/caldav/sync` | `{ direction, calendarUrl, force, uids }`；有冲突/失败返回 207；`uids` 用于逐条解决冲突 |
| POST | `/api/caldav/test` | 连通性测试（PROPFIND，不写数据） |

### 当前边界（明确不做）

- **删除不传播**：没有墓碑记录。别人在远端删了事件，本地条目会保留；
  本地删了条目，远端对象也留着。自动删数据风险太大，宁可手动清理。
- **只同步 VEVENT**：有 `start` 的条目。纯截止日期的任务（VTODO）暂不推。
- **不合并重复事件的例外**：`RECURRENCE-ID` 跳过（宁可少一条例外，也不破坏主事件）；
  如果远端对象是一个「主事件 + 例外实例」的合集，覆盖它时例外实例会丢失。
- **合并是字段级的，不是内容级的**：两边改同一字段时保留本地，只报告字段名，
  不会把「本地标题 + 远端标题」拼成一个奇怪的字符串。

## 配置项速查

| 变量 | 默认 | 作用 |
| ---- | ---- | ---- |
| `WORKSPACE_FILE` | `./workspace.md` | 统一数据源路径（**环境变量优先于 config.json**） |
| `CALDAV_ROOT_URL` / `CALDAV_URL` | 空 | CalDAV 根地址 |
| `CALDAV_USER` / `CALDAV_PASS` | 空 | CalDAV 凭据 |
| `CALDAV_CALENDAR_URL` | 空 | 目标日历 URL；留空自动发现第一个 |
| `CALDAV_TIMEOUT_MS` | `15000` | 单次 CalDAV 请求超时 |
| `MD_ICS_SYNC_DIRECTION` | `bidirectional` | 同步方向（push / pull / bidirectional） |
| `MD_ICS_AUTO_SYNC_MINUTES` | `0` | 自动同步间隔，0 = 仅手动 |
| `WEBDAV_URL` | 空 | WebDAV 地址；填了就启用该通道 |
| `WEBDAV_USER` / `WEBDAV_PASS` | 空 | WebDAV 凭据（坚果云强制应用密码） |
| `WEBDAV_EVENTS_PATH` | `CalDAV-Desktop` | 远端目录（文件名部分忽略） |

配置优先级：`config.json`（设置界面写入） > 环境变量 > `.env` > 代码默认值。
**路径类例外**：`WORKSPACE_FILE` 等以环境变量优先（容器部署习惯）。

## 联网自检（服务器就绪后）

```bash
# 1) 先启动后端
cd apps/server && pnpm dev

# 2) 另开终端：只读自检（status / 日历列表 / 连通性）
node scripts/verify-caldav-live.mjs
#    或指定地址：node scripts/verify-caldav-live.mjs --base http://127.0.0.1:3001
```

脚本会打印：是否已配置、目标日历、待推送条数、自动发现是否成功、连接耗时。
**它不会 push / pull 任何条目**，也不会改 workspace.md。

真实写入验证按脚本结尾的 4 步手工做：新建「同步自检」→ 推送 → 手机确认 → 拉取 → 删除。

## 排障

### WebDAV 推送 / 拉取没反应

1. `/api/webdav/status` 返回 `configured: false` → `WEBDAV_URL` 没读到（改完要重启后端）
2. 401 → 用「测试连接」确认；坚果云必须用**应用专属密码**，不是登录密码
3. 坚果云常见：`PROPFIND` 返回 404 → 远端目录写错，或未先 `MKCOL`（推送会自动建目录）
4. `conflict: true` → 远端被别的设备改过，选一边覆盖，别盲目 force

### 日历页「推送 CalDAV」报错 / 没反应

1. `GET /api/caldav/status` 看 `configured` / `calendarUrl`；
   `configured: false` 说明地址或账号没读到
2. 502 + 「本地数据不受影响」→ 服务器连不上（地址、端口、证书、Tailscale 断线）
3. 401 / 403 → 用「设置 → 同步 → 测试 CalDAV 连接」确认账号密码
4. 404 → 日历 URL 不对。Radicale 形如 `http://host:5232/<user>/<collection>/`，**要带末尾 /**
5. 结果里出现 `conflicts` → 两边都改过。看清两条内容再选「以远端为准」或「以本地为准」
6. 手机日历里出现重复 → 检查 `workspace.md` 里条目是否带 `uid`。
   删掉 `.caldav-sync-state.json` 只会让下次全量重拉，不会丢数据

### 数据文件到底在哪

```
curl http://localhost:3001/api/workspace/info
```

返回实际绝对路径。不要靠猜。

## 已废弃的东西（别再找）

| 旧设计 | 现状 |
| ------ | ---- |
| `syncStore.cachedEvents` 本地缓存、1 小时过期、离线读缓存 | 无人写入的空对象；数据一律直读 workspace.md |
| 底部状态栏同步按钮 | 布局改为左侧导航，无底部状态栏；同步入口在日历页工具栏 |
| 事件驱动自动同步 | 从未实现（现在的自动同步是服务端定时器） |
| 双文件同步（`events.md` + `工作搭子看板.md`） | 已合并为 `workspace.md`，只同步一个文件；旧路由已删除 |
| `kanbanTaskId` / `日历:<uid>` 双向绑定 | 随双文件架构一起拆掉；同一份数据不需要绑定 |
| `/api/md-bridge/sync/caldav` + `MD_ICS_ENABLED` | 路由与配置项已删除（P3）；同步走 `/api/caldav/sync` |

## Known Gaps

- CalDAV 删除不传播（无墓碑）：本地 / 远端删除都需要手动清理
- CalDAV 只同步 VEVENT，纯截止日期任务（VTODO）未同步
- 重复事件的例外实例（RECURRENCE-ID）不合并
- 各 WebDAV 服务商对 `PROPFIND` / `MKCOL` / `If-Match` 支持有差异，
  首次接入先用「测试连接」

---

**Last Updated**: 2026-11-02（CalDAV 通道切换到 workspace.md：uid / ETag 增量 / 冲突 / 自动同步）
**Related**: [../REF/DATA_SOURCE.md](../REF/DATA_SOURCE.md)、[../REF/MD_ICS_BRIDGE.md](../REF/MD_ICS_BRIDGE.md)、[TESTING.md](TESTING.md)
