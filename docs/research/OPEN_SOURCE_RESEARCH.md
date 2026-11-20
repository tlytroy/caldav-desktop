# 开源项目核验与借鉴裁决

> **核验日期**：2026-11-20
> **方法**：不采信二手整理（含 AI 生成的研究稿），全部通过 GitHub REST API（`api.github.com/repos/{owner}/{repo}`）与 npm registry（`registry.npmjs.org/{pkg}/latest`）实际请求核验；许可证以 SPDX 字段为准，GitHub 显示 `NOASSERTION` 时以 npm 元数据为准并注明。
> **结论性质**：这是**借鉴清单**，不是依赖引入清单。本项目（ChronoMD / caldav-desktop）坚持 `workspace.md` 单一事实源、本地优先；不 fork 任何竞品，不绕过现有领域数据层。
> **依赖准入**（沿用 `docs/planning/oss-reuse-audit.md` D35）：MIT / ISC / BSD-2/3 / Apache-2.0；禁 GPL / AGPL / MPL（MPL 与本项目分发策略冲突，故一并排除）；纯 JS 无原生编译；Node 22 可用；unpacked < 1 MB。

## 1. 一行裁决总览

| 裁决 | 项目 |
| --- | --- |
| ✅ 可引入代码（许可合规） | Calino、Obsidian Tasks、DayFront、Aperio（仅架构文档）、juev/lists、MD Calendar、TaskNotes、BeautyTasks、Task Gantt、task-hub、node-diff3*、micromark/mdast/remark/markdown-it、date-fns/dayjs/croner/chrono-node、cmdk/react-cmdk/zustand、webdav、Automerge、Yjs |
| 📖 只借鉴设计、不引入代码 | Syncthing（MPL）、Aperio（Rust/Tauri）、MD Calendar（架构不匹配）、Stone（无许可证） |
| ⛔ 禁止引入 | ical.js（MPL-2.0）、OpenTodo（AGPL-3.0）、calendar.md（GPL-3.0）、Stone（无许可证=保留所有权利） |

\* node-diff3 的 Node 运行兼容性见 §4 冒烟结果。

## 2. 应用层项目核验明细

| 项目 | 仓库 | 许可证(实测) | ★ | 最后 push | 语言 | 裁决与理由 |
| --- | --- | --- | --- | --- | --- | --- |
| Calino | `Ivan-Malinovski/calino` | MIT ✅ | 368 | 2026-11-16 | TypeScript | 技术栈最接近（React19 + Vite + Zustand + tsdav + ical.js + chrono-node）；借鉴自然语言创建与 CalDAV 交互；**不引入**（其依赖 ical.js 为 MPL） |
| Obsidian Tasks | `obsidian-tasks-group/obsidian-tasks` | MIT ✅ | 4106 | 2026-11-18 | TypeScript | 非常活跃；借鉴任务语法/查询/重复规则；多文件架构，不复用存储层 |
| Aperio | `Timtam/aperio` | Apache-2.0 ✅ | 4 | 2026-11-19 | Rust/Tauri | 读 `DESIGN*.md` 借鉴 Provider/Adapter 与同步引擎设计；Rust/C ABI 与本项目栈不兼容，不引入代码 |
| DayFront | `Erik-A-Smith/DayFront` | MIT ✅ | 10 | 2026-08-09 | TypeScript | 低活跃；CalDAV/Radicale/Baikal 真实服务端兼容性参考 |
| MD Calendar | `mrrepac/obsidian-md-calendar` | MIT ✅ | 3 | 2026-09-20 | TypeScript | 极小众；只借鉴「单 MD 文件 = 日历」理念；其 JSON-in-code-block 数据模型与本项目 YAML 块不兼容，不照搬 |
| juev/lists | `juev/lists` | MIT ✅ | 3 | 2026-11-18 | Rust | 本地优先 + WebDAV/CalDAV 多端同步参考；不引入代码 |
| TaskNotes | `fronglemog/obsidian-tasknotes` | MIT ✅ | 0 | 2026-10-18 | TypeScript | 0 星、低活跃；YAML frontmatter 任务字段设计可参考 |
| BeautyTasks | `avnibilgin/BeautyTasks` | MIT ✅ | 52 | 2026-08-16 | TypeScript | Todoist 风格编辑器/Quick Capture 参考 |
| Task Gantt | `katoiek/task-gantt` | MIT ✅ | 18 | 2026-11-20 | TypeScript | 时间线/里程碑/依赖参考（未来时间块视图） |
| task-hub | `saralaaga/task-hub` | MIT ✅ | 3 | 2026-10-29 | TypeScript | 集中式工作台/外部提醒参考；注意平台依赖 |
| Syncthing | `syncthing/syncthing` | **MPL-2.0** ⛔ | 90617 | 2026-11-20 | Go | 只研究冲突副本命名与生命周期思想；**禁止引入代码** |
| ical.js | `kewisch/ical.js` | **MPL-2.0** ⛔ | 1184 | 2026-11-19 | JavaScript | 与二手研究一致：排除直接依赖；现有自写 ICS converter 继续用 |
| OpenTodo | `OpenTodoApp/OpenTodo` | **AGPL-3.0** ⛔ | 595 | 2026-11-20 | Go/React | 仅看 OpenSpec 与功能规格，不碰代码 |
| calendar.md | `taskgenius/calendar.md` | **GPL-3.0** ⛔ | 5 | 2025-12-06 | TypeScript | 许可证不符且一年未更新，排除 |
| Stone | `DevoidSloth/stone` | **null（无许可证）** ⛔ | 0 | 2026-09-22 | TypeScript | 无许可 = 保留所有权利；仅看其公开语法思路，不引用任何代码/文本 |
| YourCAL | `FuzzyMistborn/YourCAL`（API 重定向为 `YourDAV`） | MIT ✅ | 14 | 2026-11-20 | TypeScript | Radicale/Baikal 兼容性参考 |

## 3. 底层组件核验明细（npm registry 权威字段）

| 包 | 版本 | 许可证 | 直接依赖数 | Node 引擎 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| `micromark` | 4.0.3 | MIT ✅ | 18 | — | 可引入；Markdown 词法结构识别（仅用于识别块边界，不全文 serialize） |
| `mdast` | 3.0.0 | MIT ✅ | 0 | — | 可引入；数据结构参考 |
| `remark` | 15.0.1 | MIT ✅ | 4 | — | 可引入；处理流水线 |
| `markdown-it` | 15.0.3 | MIT ✅ | 6 | — | 可引入 |
| `date-fns` | 4.4.0 | MIT ✅ | 0 | — | 可引入；统一日期运算 |
| `dayjs` | 1.11.23 | MIT ✅ | 0 | — | 可引入（轻量备选） |
| `croner` | 11.0.1 | MIT ✅ | 0 | `>=18.0` | 可引入；提醒调度参考 |
| `chrono-node` | 2.10.3 | MIT ✅ | 0 | `>=16` | 可引入；**英文/复杂日期辅助**，不替换现有中文快速路径（见 `oss-reuse-audit.md` §3.1 实测） |
| `cmdk` | 1.1.1 | MIT ✅ | 4 | — | 可引入；命令面板 |
| `react-cmdk` | 1.3.9 | MIT ✅ | 3 | — | 可引入（备选） |
| `zustand` | 5.1.0 | MIT ✅ | 0 | `>=12.20` | 可引入；状态管理 |
| `webdav` | 5.11.0 | MIT ✅ | 15 | `>=14` | 可引入；现有手写 fetch + If-Match 已够用，暂缓迁移 |
| `node-diff3` | 4.0.0 | **npm: MIT** ✅ / GitHub: `NOASSERTION` | 0 | **`bun:>=1.3.10`** | 见 §4 冒烟，条件可用 |
| `@automerge/automerge` | 3.5.0 | MIT ✅ | 0 | — | 可引入但**当前不需要**；单用户+人工裁决模型用 diff3 而非 CRDT |
| `yjs` | 13.6.33 | MIT ✅ | 1 | `>=16` | 同上，协同编辑场景才引入 |

**许可证核验的重要 nuance**：`node-diff3` 的 GitHub SPDX 是 `NOASSERTION`，但 npm 权威元数据是 `MIT`。这正是二手研究第七节「不能只看 GitHub 上显示的许可证」的反例——必须以包管理器元数据为准。

## 4. node-diff3 的 Node 22 冒烟测试

二手研究把 `node-diff3` 列为「最高优先级、可直接引入」的三方合并库。核验发现两个风险：(a) GitHub `NOASSERTION`；(b) v4 的 `engines` 只声明 bun，构建脚本全用 bun。因此做了实际运行验证（不依赖文档承诺）：

- 环境：Node **v22.23.5**（本项目目标版本，通过 nvm 实际安装验证）与 Node **v24.16.0**（当前 LTS）**均通过**
- 安装：`npm install node-diff3@4.0.0` 成功
- `import * as d3 from "node-diff3"` 成功，导出：`LCS, diff3Merge, diff3MergeRegions, diffComm, diffIndices, diffPatch, invertPatch, merge, mergeDiff3, mergeDigIn, patch, stripPatch`
- 非相邻修改的三方合并：`diff3Merge(local, base, remote)` 正确合并为 `LINE1 ... LINE5`，`conflict === false`
- 相邻冲突行正确识别为 `conflict`（本次样例中第 2 行同时被改，返回 conflict 区块）

**裁决**：许可证合规、152 KB、零运行时依赖、Node 24 下实际可 import 且三方合并行为正确。可用于未来的 `workspace.md` 文本级三方合并（P0 方向），但：
1. 使用前锁定版本 `4.0.0`；Node 22 / Node 24 导入冒烟均已实测通过；
2. 不能替代现有的**字段级领域合并**（`apps/server/src/caldav-sync.ts` 的 `mergeFields`）——文本 diff3 只作为底层兜底，领域冲突仍需用三选项 UI 交给用户裁决；
3. 若引入，需更新 `docs/planning/oss-reuse-audit.md` 的依赖记录与 `docs/UPDATE_LOG.md`。

## 5. 与本项目架构的一致性判断

采纳二手研究中的原则性判断（与现有实现方向一致）：
- 分层借鉴而非 fork 竞品；
- **同步适配器只能通过领域数据层操作 `workspace.md`，不得维护第二事实源**（现有 `mutateWorkspace` 锁 + 字段级 merge 已落实）；
- diff3 比 CRDT 更契合当前「单用户 + 单文件 + 人工裁决冲突」模型（CRDT 留作未来多端协作）；
- Markdown 保真：保留 frontmatter 原文 / 未知字段 / 未知块 / notes 原文，不做 AST 全文 serialize（现有 `workspace.ts` 已落实）；
- 依赖准入自动化：主项目 → 直接依赖 → 生产传递依赖 → 原生编译 → 打包体积逐层检查。

不采纳的部分已在 §1–§4 用实测数据纠正（node-diff3 兼容性、Stone 无许可证、MD Calendar 参考价被高估、Syncthing 本身 MPL 不符准入）。

## 6. 借鉴声明

本项目在编制过程中参考了上述项目的公开设计思路与文档（尤其是 Calino 的日历交互、Aperio 的 Provider/Adapter 架构、MD Calendar 的单文件理念、Obsidian Tasks 的任务语义、Syncthing 的冲突副本命名、node-diff3 的三方合并思路）。**未复制任何 GPL/AGPL/MPL/无许可证项目的代码**；所有借鉴均为架构思想层面，实现为本项目独立编写。README 中亦有一节简要说明。

> 本文件仅记录核验时点（2026-11-20）的事实。项目活跃度与许可证会变化，未来若真正引入某个依赖，需重新核验并走 `docs/planning/oss-reuse-audit.md` 的准入流程。
