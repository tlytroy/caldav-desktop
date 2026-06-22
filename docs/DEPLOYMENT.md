# Deployment & Packaging Guide

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

- `Radicale Desktop Calendar-0.1.0-linux.AppImage` (~100MB)
  - Single executable file, no installation needed
  - Run: `./Radicale\ Desktop\ Calendar-0.1.0-linux.AppImage`
- `Radicale Desktop Calendar-0.1.0-linux.tar.gz` (~95MB)
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

- `Radicale Desktop Calendar Setup 0.1.0.exe` (~150MB)
  - Windows installer with wizard
  - Traditional installation method
- `Radicale Desktop Calendar 0.1.0-win.zip` (~140MB)
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

- `Radicale Desktop Calendar 0.1.0.dmg` (~120MB)
  - Standard macOS installer
  - Drag app to Applications folder
- `Radicale Desktop Calendar 0.1.0-mac.zip` (~110MB)
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
./Radicale\ Desktop\ Calendar-0.1.0-linux.AppImage

# Linux (tar.gz)
tar xzf Radicale\ Desktop\ Calendar-0.1.0-linux.tar.gz
./Radicale\ Desktop\ Calendar

# Windows (.exe installer)
# Double-click the .exe file

# Windows (.zip portable)
unzip "Radicale Desktop Calendar-0.1.0-win.zip"
cd "Radicale Desktop Calendar-0.1.0-win"
Radicale\ Desktop\ Calendar.exe

# macOS (.dmg)
# Double-click .dmg, drag app to Applications

# macOS (.zip)
unzip "Radicale Desktop Calendar 0.1.0-mac.zip"
open "Radicale Desktop Calendar.app"
```

### Validation Checklist

- ✅ Application launches without errors
- ✅ Can connect to Radicale server
- ✅ Event creation works
- ✅ Event editing/deletion works
- ✅ Theme/color settings persist
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

- Clear application cache: `~/.config/Radicale Desktop Calendar/`
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

---

**Last Updated**: 2026-06-22
