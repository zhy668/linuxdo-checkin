# Linux.Do 自动签到部署指南

## 🎉 项目升级完成

项目已成功升级为 DrissionPage 版本，具备以下特性：

### ✅ 已完成的优化

1. **技术栈升级**
   - 从 Playwright 升级到 DrissionPage
   - 更好地处理 Cloudflare 验证
   - 无头模式稳定运行

2. **功能优化**
   - 去掉点赞功能，避免"很久以前"对话框问题
   - 保留浏览帖子核心功能
   - 支持多账户签到

3. **GitHub Actions 支持**
   - 添加完整的 CI/CD 配置
   - 支持定时自动运行
   - 优化 Linux 环境兼容性

## 🚀 部署到新的 GitHub 仓库

由于原仓库已归档，需要创建新仓库：

### 步骤 1: 创建新的 GitHub 仓库

1. 访问 [GitHub](https://github.com)
2. 点击 "New repository"
3. 仓库名建议：`linuxdo-checkin-enhanced`
4. 设置为 Public 或 Private
5. 不要初始化 README、.gitignore 或 license

### 步骤 2: 推送代码到新仓库

```bash
# 移除旧的远程仓库
git remote remove origin

# 添加新的远程仓库（替换为你的仓库地址）
git remote add origin https://github.com/YOUR_USERNAME/linuxdo-checkin-enhanced.git

# 推送代码
git push -u origin main
```

### 步骤 3: 配置 GitHub Secrets

在新仓库的 Settings > Secrets and variables > Actions 中添加：

**必需的 Secrets:**
- `LINUXDO_USERNAME`: 你的 Linux.Do 用户名
- `LINUXDO_PASSWORD`: 你的 Linux.Do 密码

**可选的 Secrets:**
- `GOTIFY_URL`: Gotify 服务器地址
- `GOTIFY_TOKEN`: Gotify 应用令牌

**多账户配置:**
```
LINUXDO_USERNAME=user1;user2;user3
LINUXDO_PASSWORD=pass1;pass2;pass3
```

### 步骤 4: 启用 GitHub Actions

1. 进入仓库的 Actions 页面
2. 如果提示启用 Actions，点击启用
3. 工作流将每天北京时间早上8点自动运行

### 步骤 5: 手动测试

可以在 Actions 页面手动触发工作流进行测试：
1. 点击 "Linux.Do Auto Checkin" 工作流
2. 点击 "Run workflow"
3. 选择分支并运行

## 📁 项目文件说明

```
linuxdo-checkin/
├── .github/workflows/checkin.yml  # GitHub Actions 工作流
├── main.py                        # 主程序（DrissionPage版本）
├── requirements.txt               # Python依赖
├── .gitignore                     # Git忽略文件
├── README_NEW.md                  # 新版说明文档
└── DEPLOYMENT_GUIDE.md           # 本部署指南
```

## 🔧 技术特点

- **DrissionPage**: 更好的反爬虫能力
- **无头模式**: 适合服务器环境
- **智能等待**: 随机延时模拟真实用户
- **错误处理**: 完善的重试和异常处理
- **多账户**: 支持批量签到

## ⚠️ 注意事项

1. **合理使用**: 避免频繁请求，建议使用小号测试
2. **GitHub Actions 限制**: 注意使用配额
3. **时区设置**: 工作流使用 UTC 时间，已调整为北京时间早上8点
4. **日志查看**: 可在 Actions 页面查看运行日志

## 🎯 测试结果

✅ 无头模式测试成功
✅ 登录功能正常
✅ 浏览帖子功能正常
✅ 多账户支持正常
✅ 连接信息获取正常

项目已准备好部署到 GitHub Actions！
