# CalDAV Calendar - Android版本

这个项目已经配置好了Android支持，使用Capacitor框架将Web应用转换为原生Android应用。

## 当前状态

✅ **已完成**:
- Web应用开发完成，支持所有核心功能
- Android项目结构已配置
- Capacitor集成已完成
- 触摸优化和响应式设计已实现
- UI适配移动端

## 如何构建Android APK

### 方法1: 使用构建脚本 (推荐)
```bash
cd /home/atdoc/projects/radicale-desktop
./build-android-apk.sh
```

### 方法2: 手动构建
1. 构建Web应用:
   ```bash
   cd apps/renderer
   npm run build
   ```

2. 同步到Android项目:
   ```bash
   npx cap copy android
   ```

3. 构建APK:
   ```bash
   cd android
   ./gradlew assembleDebug
   ```

## APK位置
- Debug版本: `apps/renderer/android/app/build/outputs/apk/debug/app-debug.apk`

## 移动端特性

### UI优化
- 触摸友好的按钮和控件
- 响应式布局适配各种屏幕尺寸
- 移动设备专用的模态框和表单
- 优化的滚动体验

### 功能完整
- 完整的日历功能 (创建/编辑/删除事件)
- CalDAV同步支持
- 分类和标签系统
- 重复事件支持
- 深色/浅色主题切换

## 环境要求

要构建Android APK，您需要:

1. **Java JDK 11+**
2. **Android SDK** (包含platform-tools, build-tools, platforms)
3. **Node.js 16+**
4. **npm/pnpm**

详细安装指南请参考: [ANDROID_BUILD_GUIDE.md](ANDROID_BUILD_GUIDE.md)

## 未来改进

1. **推送通知** - 集成FCM实现事件提醒
2. **离线支持** - 增强本地缓存机制
3. **生物识别** - 添加指纹/面部识别登录
4. **小部件** - 添加桌面小部件支持