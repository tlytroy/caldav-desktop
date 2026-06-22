#!/bin/bash

# Radicale Desktop 测试脚本
# 用于验证新添加的功能

echo "========================================="
echo "Radicale Desktop 功能测试"
echo "========================================="

# 检查项目目录结构
echo "1. 检查项目目录结构..."
if [ -d "apps/renderer/src/components/settings" ]; then
    echo "✅ 设置组件目录存在"
else
    echo "❌ 设置组件目录不存在"
fi

# 检查关键文件是否存在
echo "2. 检查关键文件..."
FILES=(
    "apps/renderer/src/store/themeStore.ts"
    "apps/renderer/src/components/settings/SettingsModal.tsx"
    "apps/renderer/src/components/ui/ThemeToggle.tsx"
    "UPDATE_LOG.md"
)

for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "✅ $file 存在"
    else
        echo "❌ $file 不存在"
    fi
done

# 检查 package.json 中的依赖
echo "3. 检查依赖..."
if grep -q "lucide-react" "apps/renderer/package.json"; then
    echo "✅ lucide-react 依赖存在"
else
    echo "❌ lucide-react 依赖不存在"
fi

# 检查 Tailwind 配置
echo "4. 检查 Tailwind 配置..."
if grep -q "morandi" "apps/renderer/tailwind.config.js"; then
    echo "✅ 莫兰迪配色配置存在"
else
    echo "❌ 莫兰迪配色配置不存在"
fi

if grep -q "borderRadius" "apps/renderer/tailwind.config.js"; then
    echo "✅ 圆角配置存在"
else
    echo "❌ 圆角配置不存在"
fi

# 检查 README 更新
echo "5. 检查文档更新..."
if grep -q "Morandi Color Scheme" "README.md"; then
    echo "✅ README 已更新"
else
    echo "❌ README 未更新"
fi

if grep -q "Settings Interface" "README.md"; then
    echo "✅ README 已更新设置界面信息"
else
    echo "❌ README 未更新设置界面信息"
fi

# 检查开发路线图更新
if grep -q "Day 6" "README.md"; then
    echo "✅ 开发路线图已更新"
else
    echo "❌ 开发路线图未更新"
fi

echo "========================================="
echo "测试完成"
echo "========================================="