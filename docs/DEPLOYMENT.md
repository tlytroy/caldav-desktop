# Deployment & Packaging Guide

## 两种部署形态

| 形态 | 后端 | 前端 | 适用 |
| ---- | ---- | ---- | ---- |
| 本地一体 | 本机（Electron 内启动） | 本机 | 单机使用；应用关掉就没有提醒 |
| Docker / NAS | NAS / 服务器常驻 | 后端托管 / 浏览器 | 多设备访问、7×24 提醒推送 |

### Docker / NAS（推荐用于多设备）

```bash
# 1) 准备数据目录（可把已有 workspace.md 拷进来）
mkdir -p data
cp /path/to/workspace.md data/workspace.md   # 可选

# 2) 可选：推送 / CalDAV 密钥
cp .env.example .env

# 3) 构建并启动（国内网络建议加镜像源）
NPM_REGISTRY=https://registry.npmmirror.com \
APK_MIRROR=mirrors.aliyun.com \
docker compose up -d --build

# 4) 查看状态
docker compose logs -f
curl http://127.0.0.1:3001/health
```

访问 `http://<NAS 地址>:3001`。

没有 compose 插件时可以直接用 docker：

```bash
mkdir -p data
docker build -t caldav-desktop .
docker run -d --name caldav-desktop --restart unless-stopped \
  -p 3001:3001 -v "$PWD/data:/data" \
  -e TZ=Asia/Shanghai \
  caldav-desktop
```

- 镜像内：`STATIC_DIR=/app/public`，后端同时托管前端（无需另跑 Nginx）。
- 数据卷：`./data` 挂到 `/data`；`WORKSPACE_FILE=/data/workspace.md`，
  `APP_CONFIG_PATH=/data/config.json`。容器内以 `node` 用户（uid/gid **1000**）运行，
  entrypoint 会先探测 `/data` 可写性，不行才 `chown -R node:node /data`（不做无条件递归，
  备份多时不会拖慢启动）。
- **文件权限（重要）**：`workspace.md` 按 `0644` 落盘，宿主机用户可以直接用
  vim / Obsidian / VS Code 打开——它本来就是唯一事实源，不该只有容器能读。
  `api-token.txt` 保持 `0600`（密钥）。
- **宿主机 uid 不是 1000 时**：用 linuxserver.io 风格的 `PUID` / `PGID` 覆盖，
  容器内 `node` 用户的 uid/gid 会跟着改，`data/` 里文件的属主就与宿主机一致：

  ```bash
  # compose（默认已是 1000，非 1000 才需要改）
  #   environment: { PUID: "1001", PGID: "1001" }
  # 或 docker run:
  docker run -d -e PUID=1001 -e PGID=1001 -v ./data:/data -p 3001:3001 caldav-desktop:local
  ```

  查看自己的 uid/gid：`id -u` / `id -g`。绝大多数桌面发行版首个用户就是 1000，无需设置。
- 时区：compose 里默认 `TZ=Asia/Shanghai`（影响提醒时间的解释）。
- 升级：`docker compose build --pull && docker compose up -d`；数据不受影响。
  v0.2.x → v0.3.0 不需要迁移：`workspace.md` 格式未变，启动时会自动补齐 token 文件。
  建议升级前先 `cp data/workspace.md data/workspace.md.bak`（或直接用界面里的备份导出）。
- 回滚：保留上一个镜像 tag 即可；删掉 `data/api-token.txt` 不影响数据，降级后旧版本不读它。
- 备份：`data/workspace.md` 与 `data/config.json` 就是全部状态（
  `.workspace-backups/`、`.reminder-state.json` 也在 `data/` 下）。
- 访问令牌（v0.3.0 起）：首次启动会在 `data/api-token.txt` 生成一个 64 位十六进制 token。
  浏览器第一次打开会看到令牌页，粘贴这个 token 即可：

  ```bash
  docker compose exec -u root caldav-desktop cat /data/api-token.txt
  ```

  也可以自己指定：`API_TOKEN=<至少 32 个非空白字符>`（优先级高于文件）。
  想换 token 就删掉 `data/api-token.txt` 后重启。
  token 是**单用户**保护，不是多租户权限系统；如果要多人共用或暴露公网，
  仍然建议再套一层反向代理鉴权（Nginx basic auth / Authelia / Cloudflare Access / Tailscale）。
- 只读挂载：如果 `/data` 被挂成只读（或 9p/SMB 导致自检不通过），服务会**只读启动**：
  页面能看、能导出，但任何写操作返回 503，启动日志会明确说明。确认文件系统其实可用时，
  可以设 `ALLOW_UNSAFE_FS=1` 跳过自检（风险自担）。

### 只跑前端，连远端后端

1. 在后端所在机器把服务跑起来（Docker 或 `cd apps/server && pnpm build && node dist/index.js`）
2. 前端可用任意静态托管（或直接用后端托管的页面）
3. 在「设置 → 通用 → 后端地址」填 `http://nas:3001` 并保存刷新
   （存 localStorage，不改 config.json）

构建时也可以直接注入：

```bash
VITE_API_URL=http://nas:3001 pnpm --filter caldav-renderer build
```

Electron 若只想做「外壳」连远端后端，可在主进程里跳过本地 server 启动，
并把 `window.__API_BASE_URL__` 设为远端地址（当前仓库尚未提供该打包开关）。

## Platform-Specific Builds

### Linux (All Distributions)

#### Prerequisites

- Node.js 20+ LTS
- pnpm
- Linux environment (native or WSL2)

#### Build Steps

```bash
# Install dependencies
pnpm install

# Build for Linux
cd apps/desktop
pnpm build

# Package as AppImage and tar.gz
pnpm package:linux
```

#### Outputs

Generated in `apps/desktop/dist-electron/`:

- `CalDAV-Desktop-0.1.0-linux.AppImage` (~100MB)
  - Single executable file, no installation needed
  - Run: `./CalDAV-Desktop-0.1.0-linux.AppImage`
- `CalDAV-Desktop-0.1.0-linux.tar.gz` (~95MB)
  - Portable compressed archive
  - Extract and run binary directly

**Current Status**: ✅ Pre-built packages available

---

### Windows

#### Prerequisites

- Windows environment (native Windows, not WSL2 or Linux)
- Node.js 20+ LTS
- pnpm
- Visual C++ Build Tools (for native dependencies)

#### Important Notes

- **Cannot build Windows packages from Linux/WSL2**
- Must execute build on actual Windows machine
- Build process takes 10-15 minutes

#### Build Steps (On Windows)

```bash
# Install dependencies
pnpm install

# Build for Windows
cd apps/desktop
pnpm build

# Package as .exe installer and .zip portable
pnpm package:win
```

#### Outputs

Generated in `apps/desktop/dist-electron/`:

- `CalDAV Desktop Setup 0.1.0.exe` (~150MB)
  - Windows installer with wizard
  - Traditional installation method
- `CalDAV-Desktop-0.1.0-win.zip` (~140MB)
  - Portable version, no installation needed
  - Extract and run `.exe` directly

#### Troubleshooting

**Slow build speed?**
Use Chinese mirrors for faster downloads:

```bash
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
pnpm package:win
```

Or add to `.npmrc`:

```
electron_mirror=https://npmmirror.com/mirrors/electron/
```

**Missing icon warnings?**
Add application icon:

1. Create 256x256 PNG: `apps/desktop/build/icon.png`
2. electron-builder will auto-detect it

**Build fails with dependencies?**

```bash
# Clear cache and reinstall
rm -r node_modules pnpm-lock.yaml
pnpm install
pnpm package:win
```

**Status**: ⏳ Build on Windows using above steps

---

### macOS

#### Prerequisites

- macOS environment (Intel or Apple Silicon)
- Node.js 20+ LTS
- pnpm
- Xcode Command Line Tools: `xcode-select --install`

#### Build Steps (On macOS)

```bash
# Install dependencies
pnpm install

# Build for macOS
cd apps/desktop
pnpm build

# Package as .dmg installer and .zip
pnpm package:mac
```

#### Outputs

Generated in `apps/desktop/dist-electron/`:

- `CalDAV Desktop 0.1.0.dmg` (~120MB)
  - Standard macOS installer
  - Drag app to Applications folder
- `CalDAV-Desktop-0.1.0-mac.zip` (~110MB)
  - Portable zip archive
  - Extract and run directly

#### macOS-Specific Notes

- Builds support both Intel (x86_64) and Apple Silicon (arm64)
- Signed builds require Apple Developer certificate for distribution
- First run may show security warning - allow from Security & Privacy settings

**Status**: ⏳ Build on macOS using above steps

---

## Testing Packaged Apps

### Test Installation

```bash
# Linux (AppImage)
./CalDAV-Desktop-0.1.0-linux.AppImage

# Linux (tar.gz)
tar xzf CalDAV-Desktop-0.1.0-linux.tar.gz
./CalDAV-Desktop

# Windows (.exe installer)
# Double-click the .exe file

# Windows (.zip portable)
unzip "CalDAV-Desktop-0.1.0-win.zip"
cd "CalDAV-Desktop-0.1.0-win"
CalDAV-Desktop.exe

# macOS (.dmg)
# Double-click .dmg, drag app to Applications

# macOS (.zip)
unzip "CalDAV Desktop 0.1.0-mac.zip"
open "CalDAV Desktop.app"
```

### Validation Checklist

- ✅ Application launches without errors
- ✅ Can connect to Radicale server
- ✅ Event creation works
- ✅ Event editing/deletion works
- ✅ Theme/color settings persist
- ✅ Sync management features work (status bar, intervals, manual sync)
- ✅ No missing dependencies errors

---

## Distribution & Release

### Pre-Release Checklist

- [ ] All tests passing locally
- [ ] Build succeeds on target platform
- [ ] Application starts cleanly
- [ ] Basic functionality verified
- [ ] Version number updated
- [ ] Changelog updated

### Release Steps

1. Update version in `package.json`: `"version": "0.2.0"`
2. Update [CHANGELOG.md](CHANGELOG.md)
3. Build on each platform (or use CI/CD)
4. Test each platform build
5. Create GitHub release with binaries
6. Include installation instructions per platform

### Recommended Distribution Methods

**For End Users**:

- Publish .exe on Windows Store / Microsoft Store
- Publish .dmg on AppStore (requires signing)
- Create installers for Linux distributions
- Host AppImage on GitHub Releases

**For Developers**:

- Provide `.tar.gz` for Linux (simplest)
- GitHub Actions for automated multi-platform builds

---

## Auto-Updates (Future)

For automatic updates in production:

1. Set up update server (Squirrel.Windows, Sparkle for macOS)
2. Add electron-updater configuration
3. Implement update checking on app start
4. See electron-builder docs for details

---

## Code Signing (For Distribution)

### macOS Code Signing (Required for Mac App Store)

```bash
# Set environment variables
export APPLE_ID="your@apple.com"
export APPLE_ID_PASSWORD="your-app-password"
export APPLE_TEAM_ID="XXXXXXXXXX"

# Build with signing
pnpm package:mac
```

### Windows Code Signing (For .exe trust)

```bash
# Requires Microsoft Authenticode certificate
# Configure in electron-builder.json
```

---

## CI/CD Integration

### GitHub Actions Example

Create `.github/workflows/build.yml`:

```yaml
name: Build Apps
on: [push, pull_request]

jobs:
  build-linux:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: "20"
      - run: npm install -g pnpm
      - run: pnpm install
      - run: cd apps/desktop && pnpm build && pnpm package:linux
      - uses: actions/upload-artifact@v3
        with:
          name: linux-artifacts
          path: apps/desktop/dist-electron/

  build-windows:
    runs-on: windows-latest
    # Same steps but with pnpm package:win

  build-macos:
    runs-on: macos-latest
    # Same steps but with pnpm package:mac
```

---

## Troubleshooting

### Common Issues

**App won't start after installation**

- Clear application cache: `~/.config/CalDAV Desktop/`
- Check logs in dev tools
- Verify Radicale server is accessible

**Server connection fails**

- Test with: `curl https://your-radicale-url/`
- Check firewall/proxy settings
- Verify credentials in settings

**Performance issues**

- Check available disk space
- Review calendar event count
- Monitor CPU/memory usage
- See TESTING.md for performance baselines

### Docker 构建失败排查（国内网络）

镜像里 `pnpm install` 要下 600+ 个包，国内直连 registry.npmjs.org 很容易半路超时。按下面顺序试：

```bash
# 1) 换 npm / apk 镜像源（最有效）
docker build \
  --build-arg NPM_REGISTRY=https://registry.npmmirror.com \
  --build-arg APK_MIRROR=mirrors.aliyun.com \
  -t caldav-desktop:0.3.0 .

# 2) 还是超时：把并发降到 1，只影响速度不影响结果
#    改 Dockerfile 里的 --network-concurrency=4 为 1
```

**`--mount=type=cache` 用不了？** 那是 BuildKit 语法。如果 `docker buildx version`
报 `unknown command`、或构建直接报
`BuildKit is enabled but the buildx component is missing or broken`，
说明这台机器没装 buildx 插件，请用当前仓库里的 Dockerfile（已不含 cache mount），
只依赖普通层缓存。装 buildx 需要 root（`apt install docker-buildx-plugin`），
在 NAS / 受管主机上通常没必要。

**构建到 `COPY pnpm-lock.yaml` 就失败**：`--frozen-lockfile` 要求 lockfile 与
`package.json` 一致。本地改过依赖但没 `pnpm install` 时先跑一次再构建。

**容器起来了但页面 404**：确认镜像里带了前端产物（`/app/public/index.html`），
并检查 `STATIC_DIR=/app/public` 没被环境变量覆盖。

**容器起来了但 API 全是 401**：这是 v0.3.0 起的正常行为。取 token：

```bash
docker compose exec -u root caldav-desktop cat /data/api-token.txt
```

---

**Last Updated**: 2026-06-25

## 📢 Major Update - June 25, 2026

### 🧹 Repository Optimization

The repository has been significantly optimized by removing large build artifacts from Git history. This improves:

- **Clone Speed**: Faster repository cloning
- **Storage Efficiency**: Reduced disk space usage
- **Performance**: Better Git operation performance

### 📦 Build Artifact Distribution Change

**Important Notice**: Build artifacts (AppImage, .exe, .dmg, etc.) are no longer stored in the main repository. They are now distributed exclusively through:

1. **GitHub Releases**: https://github.com/tlytroy/caldav-desktop/releases
2. **Manual Build**: Follow build instructions in this document

This change ensures:
- Cleaner repository history
- Faster development workflow
- More reliable CI/CD processes
- Better separation of source code and binaries

### 🛠️ Recent Improvements (June 30, 2026)

Additional improvements have been made to enhance stability and user experience:

- **Enhanced Delete Functionality**: Improved event deletion with better error handling and user feedback
- **Robust Sync Management**: Enhanced cache mechanisms and background synchronization
- **Improved Error Handling**: More graceful handling of network issues and server errors