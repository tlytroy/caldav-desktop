# 贡献指南

感谢您对 Radicale Desktop Calendar 项目的兴趣！我们欢迎各种形式的贡献。

## 🎯 贡献方式

### 报告问题
- 使用 GitHub Issues 报告 bug
- 请提供详细的复现步骤
- 包含您的操作系统和版本信息

### 功能请求
- 在 Issues 中描述您想要的功能
- 解释该功能如何改善用户体验
- 如果可能，提供实现思路

### 代码贡献
1. Fork 项目仓库
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 🛠️ 开发环境设置

### 前提条件
- Node.js 20+
- pnpm

### 安装步骤
```bash
# 克隆仓库
git clone https://github.com/yourusername/radicale-desktop.git
cd radicale-desktop

# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev
```

## 📝 代码规范

### TypeScript
- 遵循严格的类型检查
- 使用有意义的变量和函数命名
- 添加必要的注释

### React
- 使用函数组件和 Hooks
- 遵循组件复用原则
- 保持组件单一职责

### 提交信息
- 使用清晰的提交信息
- 遵循 conventional commits 格式
- 每次提交应该只包含一个逻辑变更

## 🧪 测试

### 运行测试
```bash
# 运行 API 测试
./run-tests.sh

# 运行前端测试（如果有的话）
pnpm test
```

### 编写测试
- 为新功能添加测试用例
- 确保所有测试通过后再提交
- 测试应该覆盖主要的功能路径

## 📚 文档

### 更新文档
- 修改代码时同步更新相关文档
- 保持文档与代码的一致性
- 使用清晰易懂的语言

## 🎨 设计原则

### 用户体验
- 保持界面简洁直观
- 遵循无障碍设计原则
- 确保跨平台一致性

### 性能
- 优化加载时间和响应速度
- 减少不必要的资源消耗
- 实施适当的缓存策略

## 🚀 发布流程

1. 更新版本号
2. 更新 CHANGELOG.md
3. 创建发布标签
4. 构建发布包
5. 发布到 GitHub Releases

## 🤖 AI 辅助开发

本项目在开发过程中使用了 AI 编程助手来提高开发效率，但我们始终：
- 保持对代码质量的严格要求
- 进行人工代码审查
- 确保所有代码符合项目规范
- 维护清晰的开发文档

## 💬 社区行为准则

- 保持尊重和专业的态度
- 提供建设性的反馈
- 帮助新手开发者
- 遵守开源社区的最佳实践

## 📞 联系方式

如有任何问题，请通过以下方式联系我们：
- GitHub Issues
- 项目维护者邮箱

再次感谢您的贡献！