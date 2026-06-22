#!/bin/bash

# CalDAV Desktop 一键发布脚本
# 使用说明：
# 1. 给脚本添加执行权限: chmod +x publish.sh
# 2. 运行脚本: ./publish.sh

set -e  # 遇到错误时停止执行

echo "🚀 CalDAV Desktop 一键发布脚本"
echo "================================"

# 检查是否在正确的目录
if [ ! -f "package.json" ]; then
    echo "❌ 错误: 请在项目根目录运行此脚本"
    exit 1
fi

echo "✅ 当前在项目根目录"

# 检查是否已安装 GitHub CLI
if ! command -v gh &> /dev/null; then
    echo "⚠️  GitHub CLI 未安装，正在安装..."

    # 更新包列表
    echo "🔄 更新包列表..."
    sudo apt update

    # 安装 GitHub CLI
    echo "📥 安装 GitHub CLI..."
    sudo apt install gh -y

    echo "✅ GitHub CLI 安装完成"
else
    echo "✅ GitHub CLI 已安装"
fi

# 登录 GitHub (如果尚未登录)
echo "🔐 检查 GitHub 登录状态..."
if ! gh auth status &> /dev/null; then
    echo "🔑 请登录到 GitHub:"
    gh auth login
else
    echo "✅ 已登录到 GitHub"
fi

# 获取当前版本
VERSION=$(node -p "require('./package.json').version")
echo "📦 当前版本: v$VERSION"

# 进入项目目录
cd /home/atdoc/projects/radicale-desktop

# 创建 GitHub 仓库
echo "🆕 创建 GitHub 仓库..."
REPO_EXISTS=$(gh repo view "caldav-desktop" 2>/dev/null && echo "yes" || echo "no")

if [ "$REPO_EXISTS" = "yes" ]; then
    echo "✅ 仓库已存在"
else
    gh repo create caldav-desktop --public --clone
    echo "✅ 仓库创建成功"
fi

# 推送代码
echo "📤 推送代码到 GitHub..."
git push -u origin main
echo "✅ 代码推送完成"

# 创建 Release
echo "🏷️  创建 Release v$VERSION..."
gh release create "v$VERSION" \
    --title "v$VERSION - Production Ready" \
    --notes "## CalDAV Desktop v$VERSION - Production Ready

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
- Linux: \`CalDAV-Desktop-$VERSION-linux.AppImage\` (~100MB)
- Linux: \`CalDAV-Desktop-$VERSION-linux.tar.gz\` (~95MB)
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

Built with ❤️ using AI assistance"

echo "✅ Release v$VERSION 创建完成"

echo ""
echo "🎉 发布成功！"
echo "=============="
echo "您的项目已成功发布到 GitHub:"
echo "🔗 https://github.com/$(gh api user | jq -r .login)/caldav-desktop"
echo "📄 README: https://github.com/$(gh api user | jq -r .login)/caldav-desktop#readme"
echo "📥 Releases: https://github.com/$(gh api user | jq -r .login)/caldav-desktop/releases"
echo ""
echo "恭喜您发布成功！ 🎉"