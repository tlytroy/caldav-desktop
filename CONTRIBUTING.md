# Contribution Guidelines

Thank you for your interest in the CalDAV Desktop project! We welcome contributions of all kinds.

## 🎯 Ways to Contribute

### Reporting Issues
- Use GitHub Issues to report bugs
- Provide detailed reproduction steps
- Include your operating system and version information

### Feature Requests
- Describe the feature you want in Issues
- Explain how the feature would improve user experience
- Provide implementation ideas if possible

### Code Contributions
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 🛠️ Development Environment Setup

### Prerequisites
- Node.js 20+
- pnpm

### Installation Steps
```bash
# Clone the repository
git clone https://github.com/yourusername/caldav-desktop.git
cd caldav-desktop

# Install dependencies
pnpm install

# Start development servers
pnpm dev
```

## 📝 Code Standards

### 架构铁律（先看这条，否则改动会被打回）

1. **只有一个数据文件**：`workspace.md`。
   不要再引入第二个 md 文件，也不要复活 `events.md` / `工作搭子看板.md`。
2. **模块之间不做同步、不做绑定**。日历 / 看板 / 工作台都是对同一份数据的
   不同筛选（`scope=calendar` / `scope=board`），不存在「绑定字段」「级联删除」「解绑」。
3. **唯一允许的格式转换是 md ↔ ics**，且只在 `apps/server/src/ics-convert.ts` 里做。
4. **新增字段要同步四处**：
   `schema/item.schema.json`、`workspace.ts` 的 `WorkbenchItem`、
   `validateItem()`、`apps/renderer/src/api/workspace.ts` 的类型。
   漏一处就会出现「能写不能读」或「校验形同虚设」。
5. **界面不要读 store 里的业务数据副本**。`syncStore.cachedEvents` 曾经就是
   这样一个「无人写入的空缓存」，导致工作台数字恒为 0 —— 一律 `fetchItems()`。

细节见 [REF/DATA_SOURCE.md](REF/DATA_SOURCE.md)（含「后续开发的铁律」章节）。

### TypeScript
- Follow strict type checking
- Use meaningful variable and function names
- Add necessary comments

### React
- Use functional components and Hooks
- Follow component reuse principles
- Maintain single responsibility principle
- Implement proper state management with Zustand（**只放 UI 状态**，业务数据在 workspace.md）

### Commit Messages
- Use clear commit messages
- Follow conventional commits format
- Each commit should contain only one logical change

## 🧪 Testing

### Running Tests
```bash
# 后端：15 文件，312 通过 / 33 跳过（跳过的 e2e 需要真实 CalDAV 服务器）
cd apps/server && pnpm test

# 前端：8 文件，75 通过
cd apps/renderer && pnpm test

# 类型检查 / 构建
cd apps/server && npx tsc --noEmit
cd apps/renderer && npx tsc --noEmit && pnpm build

# 需要真实 CalDAV 时才跑跳过的 e2e
RUN_E2E=1 pnpm test
```

> 注：仓库中**没有** `run-tests.sh`（2026-06 的文档曾引用它，实际从未存在）。
> `scripts/run-all-tests.sh` 是旧的发布脚本，不是测试入口。
> 完整测试清单与回归点见 [docs/TESTING.md](docs/TESTING.md)。

### Writing Tests
- Add test cases for new features
- Ensure all tests pass before committing
- 数字变了就更新文档里的数字 —— 文档写「121 通过」而实际 312，下一个人会白查半天

## 📚 Documentation

### Updating Documentation
- **改代码就同步改文档** —— 本项目历史上最大的坑就是文档停在旧架构上，
  后来的人照着 `events.md` 的说明写代码，全白写
- 改完后在文档底部更新 `Last Updated`
- 文档里写数字（测试数、chunk 体积）必须来自实际执行

### Documentation Structure
- [README.md](README.md) — 项目概览与快速开始
- [REF/README.md](REF/README.md) — **文档索引：哪份可信、哪份是历史稿**
- [REF/DATA_SOURCE.md](REF/DATA_SOURCE.md) — 统一数据源（权威）
- [REF/MD_ICS_BRIDGE.md](REF/MD_ICS_BRIDGE.md) — 唯一格式转换层（权威）
- [REF/ARCHITECTURE.md](REF/ARCHITECTURE.md) — 模块化框架与数据层
- [docs/SYNC_MANAGEMENT.md](docs/SYNC_MANAGEMENT.md) — 同步通道现状
- [docs/TESTING.md](docs/TESTING.md) — 测试清单与结果
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — 构建打包
- [docs/CHANGELOG.md](docs/CHANGELOG.md) / [docs/UPDATE_LOG.md](docs/UPDATE_LOG.md) — 变更记录

## 🎨 Design Principles

### User Experience
- Keep the interface simple and intuitive
- Follow accessibility design principles
- Ensure cross-platform consistency

### Performance
- Optimize loading times and response speed
- Reduce unnecessary resource consumption
- Implement appropriate caching strategies
- Use smart sync management to minimize network requests

## 🚀 Release Process

1. Update version number
2. Update CHANGELOG.md
3. Create release tag
4. Build release packages
5. Publish to GitHub Releases

## 🤖 AI-Assisted Development

This project uses AI programming assistants during development to improve efficiency, but we always:
- Maintain strict code quality requirements
- Conduct manual code reviews
- Ensure all code meets project standards
- Maintain clear development documentation

## 💬 Community Code of Conduct

- Maintain respectful and professional attitudes
- Provide constructive feedback
- Help novice developers
- Follow open-source community best practices

## 📞 Contact

If you have any questions, please contact us through:
- GitHub Issues
- Project maintainer email

Thank you again for your contribution!