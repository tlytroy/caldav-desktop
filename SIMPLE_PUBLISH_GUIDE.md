# CalDAV Desktop 发布到 GitHub 的简化步骤

## 第一步：安装 GitHub CLI
```bash
# 更新包列表
sudo apt update

# 安装 GitHub CLI
sudo apt install gh -y
```

## 第二步：登录 GitHub
```bash
# 登录到 GitHub
gh auth login
```
按照提示选择：
- GitHub.com
- HTTPS
- Yes (authenticate Git with your GitHub credentials)
- Login with a web browser

然后复制提供的代码并在打开的浏览器中粘贴以完成认证。

## 第三步：创建仓库并发布
```bash
# 进入项目目录
cd /home/atdoc/projects/radicale-desktop

# 创建 GitHub 仓库
gh repo create caldav-desktop --public --push

# 如果上面的命令不工作，使用以下命令：
# gh repo create caldav-desktop --public
# git push -u origin main
```

## 第四步：创建 Release
```bash
# 创建 Release
gh release create "v0.1.0" --title "v0.1.0 - Production Ready" --notes "🎉 Initial release of CalDAV Desktop - A cross-platform desktop calendar application with full CalDAV support!

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

Built with ❤️ using AI assistance"
```

完成这些步骤后，您的项目将会在 GitHub 上发布，地址为：https://github.com/YOUR_GITHUB_USERNAME/caldav-desktop

如果您在执行过程中遇到任何问题，请告诉我具体的错误信息，我会帮助您解决。