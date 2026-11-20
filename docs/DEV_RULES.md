# ChronoMD 开发规范（DEV_RULES）

> 版本：v1.0（2026-11-02）
> 适用范围：本仓库所有代码、文档、AI 编程任务。
> 与 `REF/ARCHITECTURE.md`、`REF/DATA_SOURCE.md`、`docs/planning/v0.3-plan.md` 冲突时，以更具体者为准；
> 架构/数据层决策仍以 `docs/planning/reviews/decision-log.md` 为最终记录。

---

## 1. 总原则

1. **不重写，渐进演进**：当前是已运行的模块化单体（Node/TS + React），不是绿地项目。
   禁止为了「架构更纯」整体迁移 Python/FastAPI、拆微服务或重排目录。
2. **模块化单体**：一个进程、一个数据库（目前是 `workspace.md`）、清晰模块边界；
   不引入服务间通信、独立部署单元。
3. **契约优先**：先定义接口/数据/错误，再实现；接口变更必须同步测试与文档。
4. **本地优先**：任何功能在无网络/无服务器时（本地模式）必须可用；
   同步、推送、AI 是可选外挂。
5. **单一事实源**：`workspace.md`；状态文件必须可重建；禁止第二份业务数据。
6. **小步交付**：每个 PR 只做一件事，保持主分支可运行；禁止顺手重构无关模块。
7. **不重复造轮子**：通用能力先找成熟开源库（准入标准见 D35 与 `docs/planning/oss-reuse-audit.md`）；
   自己写只保留领域数据格式与库覆盖不到的语义。替换前先写对比结论，替换后原测试必须全绿。

---

## 2. 分层与依赖方向

```
交互层      React 页面 / 组件 / API client
  ↓
HTTP 层     apps/server/src/routes/*（参数校验、HTTP 映射，不含业务规则）
  ↓
服务层      domain services（任务/日历/同步编排/备份/认证）
  ↓
仓储层      workspace repository（read/mutate/backup/state）
  ↓
适配层      Markdown / ICS / CalDAV / WebDAV / Push / FS
```

规则：

- 依赖只能向下，**禁止反向**（适配层不得 import 路由）。
- 禁止循环依赖。
- 路由不得直接 `fs.writeFileSync(workspace.md)`；写操作必须经 `mutateWorkspace`。
- 适配器（CalDAV/WebDAV/ICS/Push）不包含业务规则；业务规则在服务层。
- 前端不得直接读写文件/数据库，只能调 API。
- 新增模块必须声明：职责、公开接口、依赖、测试入口。

### 当前代码的映射（不要求一次到位）

| 层 | 当前文件 | 状态 |
| --- | --- | --- |
| HTTP | `apps/server/src/routes/*` | 已有，部分路由含业务逻辑 |
| 服务 | `caldav-sync.ts`、`webdav.ts`、`notifications/*`、`nlp/*` | 部分有 |
| 仓储 | `workspace.ts`（parse/read/write/backup） | 有，v0.3 收敛为 `mutateWorkspace` |
| 适配 | `ics-convert.ts`、`caldav.ts`、`webdav.ts`、`push.ts` | 有 |
| 前端 | `apps/renderer/src/modules/*`、`components/*`、`api/*` | 有模块注册表 |

> 方向：v0.3 只把「写路径/认证/恢复」收敛到服务层；不为了分层而搬动所有文件。

---

## 3. 数据规则

1. `workspace.md` 是唯一事实源；`id` 稳定、永不复用；外部身份用 `uid`。
2. 读失败必须报错，禁止返回空集合后继续写（会清空事实源）。
3. 所有写路径必须经过 `mutateWorkspace(fn)`：锁 → 重读 → 修改 → 校验 → 原子写。
4. 写入前做图校验：id 唯一、parent 存在、无环、时间合法。
5. 未知字段/未知块/frontmatter 必须原样保留；序列化幂等。
6. 状态文件（`.caldav-sync-state.json`、`.webdav-state.json`、`.reminder-state.json`）
   是可重建缓存；`sync`/etag 不写进 MD。
7. 备份是恢复材料，不是事实源；恢复必须显式确认、先备份当前、重置状态。
8. 不得引入第二份业务数据文件；`vault/` 导出只能是投影。

---

## 4. 接口与错误

- API 路径保持 `/api/*`；新增接口必须写进 SDS 与 `docs/`。
- 成功响应沿用 `{ success: true, ... }`；错误至少 `{ error: string }`。
- 状态码：400 参数、401 未授权、404 不存在、409 冲突、412 ETag、429 限流（v0.3.1）、
  500 内部错误、503 维护/锁超时。
- 401 不得泄露「token 是否存在」；错误响应不得包含 token、绝对路径、密钥。
- 破坏性接口（restore/delete all）必须 `confirm: true` + 二次确认 UI。
- 下载类接口不能依赖 `window.open` 带 header；用 fetch → Blob。

---

## 5. 测试要求

每个 PR 必须交付：

1. **一个能失败的测试**（先红后绿），覆盖新增行为或 bug。
2. 单元测试：纯函数、校验、状态转换、解析/序列化。
3. 集成测试：HTTP 路由 + 临时目录 + mock 外部服务。
4. 数据/同步改动：并发、崩溃、冲突、恢复测试。
5. 不访问真实 NAS / 真实推送 / 真实 CalDAV。

测试层次：

| 层 | 例子 |
| --- | --- |
| 单元 | `validateItem`、round-trip、token 比较、diff |
| 模块接口 | 服务层 API、`mutateWorkspace` |
| 集成 | 401/200、备份恢复、sync overview |
| 端到端 | 创建 → MD → ICS → mock CalDAV → 回写（CI 可选） |

本地命令：

```bash
pnpm -C apps/server test
pnpm -C apps/renderer test
pnpm -C apps/server build
pnpm -C apps/renderer build
```

CI 必须全绿；禁止通过删除/跳过检查来变绿（skip 需注明原因与 issue）。

---

## 6. 模块边界清单（12 模块映射）

| 模块 | 职责 | 当前实现 | 备注 |
| --- | --- | --- | --- |
| Core | 模型/Schema/规则 | `workspace.ts` 类型 + `schema/item.schema.json` | 逐步拆出纯模型 |
| Markdown | 解析/生成/校验 | `workspace.ts` parse/serialize | v0.3 加 extras |
| Repository | 文件/索引/版本 | `workspace.ts` read/write/backup | v0.3 加锁/原子写 |
| Task | 任务服务 | `routes/workspace.ts` + 前端 tasks | 服务层未拆 |
| Calendar | 事件/时间块/重复 | `routes/workspace.ts` + `Calendar.tsx` | timeblock v0.4 |
| Project | 项目/进度 | `project` 字段 + UI 分组 | 实体化 v0.4 |
| Search | 搜索/过滤 | 前端过滤 + 服务端 `filterItems` | 索引延后 |
| ICS | VEVENT/VTODO | `ics-convert.ts` | VTODO v0.4 |
| Sync | CalDAV/WebDAV/冲突 | `caldav-sync.ts`、`webdav.ts` | v0.3 收敛写路径 |
| AI | NLP/Command | `nlp/*`、QuickCreate | command layer v0.4 |
| Frontend | 页面/组件 | `modules/*`、`components/*` | v0.3 加令牌页/同步中心 |
| Infra | Docker/配置/日志 | `Dockerfile`、`config.ts` | v0.3 加 token/恢复 |

新增/修改模块时更新 `docs/MODULE_STATUS.md`。

---

## 7. AI 编程任务模板（每次必须附带）

```
模块：<名称>
依据：DEV_RULES.md / REF/DATA_SOURCE.md / docs/planning/v0.3-plan.md / 本任务 SDS 章节
范围：只做 <功能>；不做 <明确排除>
接口：<新增/修改的 API 或函数签名>
数据：<字段/状态文件/迁移>
测试：<要新增的测试与命令>
约束：不重构无关模块；不改公开接口；不删除已有功能；如必须改，先说明影响
交付：代码 + 测试 + 文档更新 + 验收命令 + 未实现/已知问题
```

---

## 8. Git / 提交 / 回滚

- 一个 PR 一个主题；提交信息 `type(scope): summary`。
- 数据/认证/同步改动必须独立 PR，附测试与文档。
- 不提交 `workspace.md`、`config.json`、`.env`、备份/状态文件。
- 每个里程碑打 tag；发布前保留上一个镜像 tag（可回滚）。
- 禁止 force-push 主分支；回滚用 revert，不改历史。

---

## 9. 评审门禁

以下改动必须独立 reviewer（不参与编写）审核：

- 数据写入/锁/原子写/恢复
- 认证/CORS/代理/Electron 注入
- 同步冲突/删除/状态重置
- 数据结构/字段/迁移
- 发布/Docker/权限

Reviewer 只看：失败场景、测试是否可失败、是否越界、文档是否同步。

---

## 10. 当前阶段（v0.3）额外约束

- 不更换数据层（单 `workspace.md`）、不重写 Python、不加 SQLite。
- 不实现多用户/共享。
- 新增依赖：运行时零新增；devDependency 需说明理由。
- 所有接口先过认证（除 `/health`、静态、`OPTIONS`）。
- 备份恢复必须与认证同版（v0.3.0），v0.2.5 只读。
