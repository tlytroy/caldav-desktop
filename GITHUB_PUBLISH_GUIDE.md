# CalDAV Desktop GitHub 发布指南

## 📋 发布前准备

### 1. 安装 GitHub CLI (可选但推荐)
如果您想使用自动化脚本发布，可以安装 GitHub CLI：

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install gh

# 安装完成后登录
gh auth login
```

### 2. 手动发布准备
如果选择手动发布，请按以下步骤操作：

## 🚀 手动发布步骤

### 1. 在 GitHub 上创建仓库
1. 访问 https://github.com/new
2. 仓库名称：`caldav-desktop`
3. 描述：`A cross-platform desktop calendar application with full CalDAV support and modern UI design`
4. 设置为 Public（公共仓库）
5. 不要初始化 README、.gitignore 或 license

### 2. 推送代码到 GitHub
```bash
# 进入项目目录
cd /home/atdoc/projects/radicale-desktop

# 添加远程仓库（将 YOUR_USERNAME 替换为您的 GitHub 用户名）
git remote add origin https://github.com/YOUR_USERNAME/caldav-desktop.git

# 推送代码
git push -u origin main
```

### 3. 配置仓库设置
1. 访问您的仓库页面：https://github.com/YOUR_USERNAME/caldav-desktop
2. 点击 "Settings" 选项卡
3. 在 "General" 部分：
   - 更新仓库描述（如果需要）
   - 添加主题标签：calendar, caldav, electron, react, typescript
4. 在 "Options" 部分：
   - 设置默认分支为 `main`
   - 配置社交预览图片（可选）

### 4. 创建第一个 Release
1. 在仓库页面点击 "Releases"
2. 点击 "Draft a new release"
3. 创建新标签：`v0.1.0`
4. 标题：`v0.1.0 - Production Ready`
5. 描述内容：

```
## CalDAV Desktop v0.1.0 - Production Ready

🎉 Initial release of CalDAV Desktop - A cross-platform desktop calendar application with full CalDAV support!

### ✨ Features
- **CalDAV Sync**: Full synchronization with Radicale servers (RFC 5545 compliant)
- **Event Management**: Create, edit, delete events with full CRUD operations
- **Advanced Features**:
  - Event categories for organization
  - Multi-tag support for flexible grouping
  - Recurring events (daily, weekly, monthly, yearly)
  - All-day events
- **Modern Design**:
  - 4 Morandi color schemes + custom colors
  - Unified rounded corner design system
  - Full dark mode support
  - Responsive layout
- **Cross-Platform**: Linux, Windows, macOS (packaged as Electron app)

### 📦 Installation
Pre-built packages available:
- Linux: `CalDAV-Desktop-0.1.0-linux.AppImage` (~100MB)
- Linux: `CalDAV-Desktop-0.1.0-linux.tar.gz` (~95MB)
- Windows/macOS: See [DEPLOYMENT.md](docs/DEPLOYMENT.md)

### 📚 Documentation
- [README.md](README.md) - Project overview and quick start
- [DEPLOYMENT.md](docs/DEPLOYMENT.md) - Building and packaging for all platforms
- [TESTING.md](docs/TESTING.md) - Test plan and results (9/9 tests passing)
- [CHANGELOG.md](docs/CHANGELOG.md) - Version history and feature updates

### 🎯 Next Steps
- Windows/macOS packaging (see [DEPLOYMENT.md](docs/DEPLOYMENT.md))
- User feedback collection
- Performance monitoring
- v0.2: Advanced filtering, event search, more themes

---

Built with ❤️ using AI assistance
```

6. 点击 "Publish release"

## 📦 后续优化建议

### 1. 添加 GitHub Actions CI/CD
创建 `.github/workflows/test.yml`：

```yaml
name: Test Suite
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: "20"
      - run: npm install -g pnpm
      - run: pnpm install
      - run: ./run-tests.sh
```

### 2. 添加 Issue Templates
创建 `.github/ISSUE_TEMPLATE/bug_report.md`：

```markdown
---
name: Bug report
about: Create a report to help us improve
title: ''
labels: bug
assignees: ''

---

**Describe the bug**
A clear and concise description of what the bug is.

**To Reproduce**
Steps to reproduce the behavior:
1. Go to '...'
2. Click on '....'
3. Scroll down to '....'
4. See error

**Expected behavior**
A clear and concise description of what you expected to happen.

**Screenshots**
If applicable, add screenshots to help explain your problem.

**Desktop (please complete the following information):**
 - OS: [e.g. Ubuntu 20.04, Windows 10, macOS Big Sur]
 - Version [e.g. 0.1.0]

**Additional context**
Add any other context about the problem here.
```

### 3. 添加 Pull Request Template
创建 `.github/PULL_REQUEST_TEMPLATE.md`：

```markdown
## Description
Brief description of the changes in this pull request.

## Related Issue
Fixes #issue_number

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Checklist
- [ ] My code follows the style guidelines of this project
- [ ] I have performed a self-review of my code
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] I have made corresponding changes to the documentation
- [ ] My changes generate no new warnings
- [ ] I have added tests that prove my fix is effective or that my feature works
- [ ] New and existing unit tests pass locally with my changes
```

## 🎉 完成！

恭喜您！您的 CalDAV Desktop 项目已经准备好发布到 GitHub。按照以上步骤操作，您的项目将在 GitHub 上线，供全世界的开发者使用和贡献。

如果您有任何问题或需要进一步的帮助，请随时联系项目维护团队。