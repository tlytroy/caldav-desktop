# 关键决策记录（v0.3）

> 规则：每个决策必须写「选了什么 / 为什么 / 谁定的 / 日期」。
> 状态：`待定` → `已定` → 如需推翻，新增一条并注明取代关系。

## 2026-11-02 · v0.3（owner 确认 + 两轮评审修订）

> 决策人：项目 owner（2026-11-02 「全按推荐」）；修订由评审 A/B 的条件驱动，owner 可在定稿前否决。

| ID | 决策点 | 决策 | 状态 |
| -- | ------ | ---- | ---- |
| D1 | 认证模型 | 单用户 Bearer Token，**fail-closed**：token 缺失时**启动并自动生成** `api-token.txt`（0600，位于数据目录），`/health` 与静态公开，其余 `/api/*` 401；不 exit、不设 `/api/auth/*`；浏览器输入 token，Electron 自动注入。 | 已定 |
| D2 | 暴露范围 | 默认内网 / Tailscale；`TRUST_PROXY_HOPS` 只影响 `req.ip`（默认 0）；hops>0 启动告警「勿直暴端口」；公网需自备 TLS 反代。 | 已定 |
| D3 | 发布与顺序 | **v0.2.5 = M1 CI + M2 数据核心 + M3a 只读备份**；**v0.3.0 = M4 认证 + M3b 恢复 + M5 只读同步中心**；M6 WebDAV 自动同步推迟 v0.3.1；E4/E5 推迟 v0.4。 | 已定 |
| D4 | CalDAV 删除传播 | v0.3 **不做**。未来做时删除键必须是 **href**（不是 uid），恢复备份时不清墓碑。 | 已定 |
| D5 | 重复事件单次编辑 | v0.4 再做，需要例外实例模型（EXDATE / override），单独 SDS。 | 已定 |
| D6 | 数据迁移 | **不建迁移框架**。只做「未知字段/块/frontmatter 往返保留 + 幂等」；未来需要时再做显式升级。 | 已定 |
| D7 | 移动端 | 先 PWA / 浏览器；Capacitor 原生壳后续。 | 已定 |
| D8 | 新依赖 | ~~运行时零新增~~ —— **2026-11-03 由 D35 取代**：按 D35 准入标准允许新增运行时依赖；测试/CI 允许必要 devDependency。 | 已定（已被 D35 修订） |
| D9 | CI | GitHub Actions：Node 22、pnpm 11.8.0、`--frozen-lockfile`、renderer 增加 `typecheck`、server 修测试类型错误（不删检查）。 | 已定 |
| D10 | SDS 粒度 | 只写 v0.3.0（含 v0.2.5）；E4/E5 只留大纲。 | 已定 |
| D11 | 恢复后状态 | 停调度 → epoch 丢弃在飞同步 → 等 inFlight → 锁 → 备份 → 覆盖 → 重置 etag → sent 按 `id|remind` 保留 → 自动同步暂停。 | 已定 |
| D12 | 锁边界 | 单进程 `mutateWorkspace`；仅「读-改-写」临界区；网络 IO 锁外；禁止重入；10s 超时；多实例写同一文件不支持（文档写明）。 | 已定 |
| D13 | E3 范围 | 只读同步中心：本地缓存聚合，不联网；最近事件仅内存；不做历史文件；不做自动同步。 | 已定 |
| D14 | 工期基线 | **18–24 人日**（M1 1.5–2、M2 6–8、M3 3–3.5、M4 4–5、M5 1.5–2、M7 1.5–2）。 | 已定 |
| D15 | 「本地优先」定义 | 仅本地模式（Electron）承诺服务器全挂仍完整可用；直连模式（浏览器连 NAS）是在线模式，服务器不可用必须明确报错，不白屏、不假装保存成功。 | 已定 |
| D16 | Electron 通道 | **只保留本地 HTTP 同源**：127.0.0.1 + 随机端口 + 等 `/health`；token 由主进程 `webRequest` 注入，**不进 renderer argv**；preload 只暴露 base；不做 `file://`、不做 `null` origin。 | 已定（2026-11-02 修订） |
| D17 | 限流 | v0.3 不做；token 256-bit，熵足够；推迟 v0.3.1 与 M6 一起评估。 | 已定 |
| D18 | 同步历史 | 不做 `.sync-history.json`；M5 只显示内存最近 20 条事件（重启清空）。 | 已定 |
| D19 | 遗留路由 | 下线 `/api/md-bridge/*` 与 `/api/kanban/*` 的**全部**路由（含读；任意 filePath 读在 v0.2.5 无认证期是 LAN 文件泄露）；ICS 导出迁到 workspace 路由，见 D29。 | 已定（2026-11-02 修订） |
| D20 | 数据层（单文件 vs 多文件） | **v0.3 保持单个 `workspace.md`**；一任务一文件/多文件仓库进入 v0.4.5 的 2 周 spike，按解析/写入/WebDAV/冲突/迁移数据出 ADR，再由 owner 决策。 | 已定 |
| D21 | 后端语言 | **不重写 Python/FastAPI**；继续 Node/TypeScript。若未来需要 Python 库，做可选 sidecar，不碰事实源。 | 已定 |
| D22 | SQLite 索引 | v0.3 不做；先测规模。若加，只作可重建缓存（id→字段/FTS），删除 DB 必须能从 MD 全量重建；禁止只写 DB。 | 已定 |
| D23 | v0.4 范围 | 语义模型（Task/Event/Time Block、scheduled/due）+ VTODO 集合 + AI Command Layer + 文件监控 + 未安排任务视图；不含数据层重写。 | 已定 |
| D24 | 同步元数据位置 | `sync`/etag/revision **不写进 MD**；放状态文件/日志（按 UID），避免同步循环与 diff 污染；UID 留在 MD。 | 已定 |
| D25 | 时区 | v0.3 保持 floating local time 并文档写明；v0.4 给 event 增加可选 IANA `tzid`（TZID+VTIMEZONE），迁移仅显式操作。 | 已定 |
| D26 | 多用户 | v0.3 单用户 token；数据模型可预留 `owner?`，但不实现账号/ACL/共享；家庭共享独立版本评估。 | 已定 |
| D27 | WebDAV merge 409 语义 | 锁外 PUT 成功但本地在合并期间被改：**不覆盖本地**，返回 409「远端已写入合并版；本地保留你的新改动，请重新合并」，带 `remoteEtag`+`localHash`；冲突入口只给「重新合并」，**禁止「拉取覆盖」**（否则会用旧合并版覆盖新改动）。 | 已定 |
| D28 | 只读 `/data` 启动 | token 先解析（写失败打印一次），存储自检失败默认**只读启动**：读 200、写 503、`storageSafe:false`，不 exit；`ALLOW_UNSAFE_FS=1` 才允许写。token 0600；容器内 `docker compose exec -u root caldav-desktop cat /data/api-token.txt` 取。 | 已定 |
| D29 | legacy 下线范围 | md-bridge/kanban 全部路由下线；`Calendar.tsx` 的 ICS 导出迁到 `api/workspace` 的 blob 导出；外部脚本迁移说明进 README。 | 已定 |

| D30 | 锁排队超时 | 等待超过 10s 的请求立即 503 并从队列移除；**只允许已开始执行的 fn 写完**，超时任务不得稍后落盘；测试「超时后无写入」。 | 已定 |
| D31 | 恢复逃生 | `POST /api/workspace/backups/restore/abort`（token + confirm）清 marker/maintenance，保留当前 workspace 与 `sync-suspended`；pinned 过期/损坏时启动自动清 marker；preview 在 maintenance 下放行。 | 已定 |
| D32 | 发布分组 | **P5+P6 同一发布**（服务端 auth + 前端 token/AuthGate + Electron 打包）；**P7+P8 同一发布**（恢复 + 最小 resume + overview）；禁止只发一半造成 401/同步停摆。 | 已定 |
| D33 | merge 元数据/失败 | WebDAV 三方合并保留 frontmatter/unknown/extra/rawBlock；`prepareMerge` 在 PUT 前解析+图校验；PUT 后 commit 失败返回 409 + `remoteEtag`/`remoteHash`，记录冲突，UI 只给重新合并。 | 已定 |
| D34 | reminder 与恢复 | reminder scheduler tick 注册为 sync activity；恢复 await tick；写 sent 前检查 epoch/maintenance；防止旧 sent 覆盖恢复后的状态。 | 已定 |
| D35 | 不重复造轮子 | **优先用成熟开源库，不自己写通用轮子**（用户 2026-11-03 明确要求）。新增依赖须满足：MIT/ISC/BSD/Apache、近 12 个月有发布、纯 JS 无原生编译、unpacked <1MB（超出需写明理由）、可离线 frozen-lockfile 安装。自研只保留：领域数据格式（workspace.md 解析/序列化）与库覆盖不到的交互语义。评估记录见 `docs/planning/oss-reuse-audit.md`。首个落地：`recurrence.ts` 展开改用 `rrule@2.8.1`（BSD-3），30 项测试保持全绿。 | 已定 |

## 已定（历史）

| 日期 | 决策 | 理由 |
| ---- | ---- | ---- |
| 2026-11-02 | 继续以 `workspace.md` 为唯一事实源，不引入第二份业务数据 | 见 `REF/DATA_SOURCE.md` 铁律 |
| 2026-11-02 | 本地优先：服务器不可用时所有本地功能必须可用 | 产品前提 |
| 2026-11-02 | Docker 作为一等部署方式（API + 前端 + 推送同容器） | 已实现并验证 |
