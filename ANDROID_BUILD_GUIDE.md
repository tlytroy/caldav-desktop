# Android应用构建完整指南

## 环境要求
- Java 11或更高版本
- Android SDK
- Node.js 16+
- npm/pnpm

## 步骤1: 安装Android开发环境

### 在Ubuntu/Debian上:
```bash
# 安装Java
sudo apt update
sudo apt install openjdk-11-jdk

# 设置环境变量
export JAVA_HOME=/usr/lib/jvm/java-11-openjdk-amd64
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/tools:$ANDROID_HOME/tools/bin:$ANDROID_HOME/platform-tools

# 添加到~/.bashrc永久生效
echo 'export JAVA_HOME=/usr/lib/jvm/java-11-openjdk-amd64' >> ~/.bashrc
echo 'export ANDROID_HOME=$HOME/Android/Sdk' >> ~/.bashrc
echo 'export PATH=$PATH:$ANDROID_HOME/tools:$ANDROID_HOME/tools/bin:$ANDROID_HOME/platform-tools' >> ~/.bashrc

# 重新加载环境变量
source ~/.bashrc
```

### 下载Android SDK命令行工具:
```bash
# 创建目录
mkdir -p $ANDROID_HOME/cmdline-tools/latest

# 下载并解压
cd /tmp
wget https://dl.google.com/android/repository/commandlinetools-linux-9477386_latest.zip
unzip commandlinetools-linux-9477386_latest.zip
mv cmdline-tools/* $ANDROID_HOME/cmdline-tools/latest/

# 安装必要组件
$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"
```

## 步骤2: 构建Web应用并同步到Android

```bash
# 进入项目目录
cd /home/atdoc/projects/radicale-desktop/apps/renderer

# 构建Web应用
npm run build

# 同步到Android项目
npx cap copy android
```

## 步骤3: 构建Android APK

```bash
# 进入Android项目目录
cd android

# 构建Debug APK
./gradlew assembleDebug

# APK位置
# app/build/outputs/apk/debug/app-debug.apk
```

## 步骤4: 构建Release版本 (可选)

```bash
# 生成签名密钥 (首次)
keytool -genkey -v -keystore my-release-key.keystore -alias caldav-calendar -keyalg RSA -keysize 2048 -validity 10000

# 构建Release APK
./gradlew assembleRelease
```

## 应用特性

### 已支持的功能:
1. ✅ 完整的日历功能 (创建/编辑/删除事件)
2. ✅ CalDAV同步
3. ✅ 响应式UI设计
4. ✅ 触摸优化
5. ✅ 主题支持 (深色/浅色模式)
6. ✅ 分类和标签系统
7. ✅ 重复事件支持

### 移动端优化:
1. ✅ 触摸友好的界面元素
2. ✅ 移动设备屏幕适配
3. ✅ 软键盘优化
4. ✅ 移动导航优化

## 故障排除

### 常见问题:
1. **JAVA_HOME错误**: 确保JAVA_HOME指向正确的JDK路径
2. **Gradle下载失败**: 检查网络连接或使用代理
3. **权限问题**: 确保对Android SDK目录有写权限
4. **内存不足**: 增加Gradle内存设置

### 性能优化建议:
1. 启用ProGuard代码混淆
2. 优化图片资源
3. 使用动态导入减少初始包大小
4. 启用Android App Bundle发布

## 未来改进方向

1. **推送通知**: 集成FCM实现事件提醒
2. **离线支持**: 增强本地缓存机制
3. **生物识别**: 添加指纹/面部识别登录
4. **小部件**: 添加桌面小部件支持
5. **分享功能**: 支持事件分享到其他应用