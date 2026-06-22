#!/bin/bash

# Radicale Desktop Calendar GitHub 发布脚本
# 使用说明：
# 1. 在 GitHub 上创建仓库 radicale-desktop-calendar
# 2. 将此脚本中的 YOUR_USERNAME 替换为你的 GitHub 用户名
# 3. 运行此脚本推送代码到 GitHub

echo "🚀 准备发布 Radicale Desktop Calendar 到 GitHub..."

# 检查是否在正确的目录
if [ ! -f "package.json" ]; then
    echo "❌ 错误: 请在项目根目录运行此脚本"
    exit 1
fi

# 检查 Git 状态
if [ ! -d ".git" ]; then
    echo "🔧 初始化 Git 仓库..."
    git init
    git add .
    git commit -m "Initial commit: Radicale Desktop Calendar v0.1.0"
fi

echo "🔗 添加远程仓库..."
# TODO: 请将 YOUR_USERNAME 替换为你的 GitHub 用户名
git remote add origin https://github.com/YOUR_USERNAME/radicale-desktop-calendar.git

echo "🔄 设置主分支..."
git branch -M main

echo "⬆️ 推送代码到 GitHub..."
git push -u origin main

echo "✅ 代码已推送到 GitHub！"

echo "📋 下一步："
echo "1. 访问 https://github.com/YOUR_USERNAME/radicale-desktop-calendar"
echo "2. 检查仓库是否正确上传"
echo "3. 在 GitHub 仓库设置中添加描述和主题"
echo "4. 考虑添加 GitHub Actions 进行 CI/CD"

echo "🎉 发布完成！"