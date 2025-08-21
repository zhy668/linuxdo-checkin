# Linux.Do 自动签到

基于 DrissionPage 的 Linux.Do 自动签到工具，支持 GitHub Actions 自动运行。

## 功能特点

- ✅ 自动登录 Linux.Do
- ✅ 自动浏览帖子完成签到
- ✅ 支持多账户
- ✅ 支持 GitHub Actions 定时运行
- ✅ 支持 Gotify 通知推送
- ✅ 自动处理 Cloudflare 验证
- ✅ 无头模式运行

## 快速开始

### 本地运行

1. 克隆项目
```bash
git clone https://github.com/your-username/linuxdo-checkin.git
cd linuxdo-checkin
```

2. 安装依赖
```bash
pip install -r requirements.txt
```

3. 配置环境变量
创建 `.env` 文件：
```env
LINUXDO_USERNAME=your_username
LINUXDO_PASSWORD=your_password
# 多账户用分号分隔
# LINUXDO_USERNAME=user1;user2
# LINUXDO_PASSWORD=pass1;pass2

# 可选：Gotify 通知
GOTIFY_URL=https://your-gotify-server.com
GOTIFY_TOKEN=your_gotify_token
```

4. 运行
```bash
python main.py
```

### GitHub Actions 自动运行

1. Fork 本项目

2. 在 GitHub 项目设置中添加 Secrets：
   - `LINUXDO_USERNAME`: 你的用户名
   - `LINUXDO_PASSWORD`: 你的密码
   - `GOTIFY_URL`: Gotify 服务器地址（可选）
   - `GOTIFY_TOKEN`: Gotify 令牌（可选）

3. 启用 GitHub Actions

程序将每天北京时间早上8点自动运行。

## 配置说明

### 环境变量

| 变量名 | 说明 | 必需 |
|--------|------|------|
| `LINUXDO_USERNAME` | Linux.Do 用户名，多账户用分号分隔 | 是 |
| `LINUXDO_PASSWORD` | Linux.Do 密码，多账户用分号分隔 | 是 |
| `GOTIFY_URL` | Gotify 服务器地址 | 否 |
| `GOTIFY_TOKEN` | Gotify 应用令牌 | 否 |

### 多账户配置

支持多账户签到，用分号分隔：
```env
LINUXDO_USERNAME=user1;user2;user3
LINUXDO_PASSWORD=pass1;pass2;pass3
```

## 技术特点

- 使用 DrissionPage 替代 Playwright，更好地处理反爬虫
- 无头模式运行，适合服务器环境
- 智能等待和重试机制
- 随机浏览行为，模拟真实用户
- 支持 GitHub Actions 云端运行

## 注意事项

- 请合理使用，避免频繁请求
- 建议使用小号进行测试
- GitHub Actions 有使用限制，请注意配额

## 许可证

MIT License

## 免责声明

本工具仅供学习交流使用，使用者需自行承担风险。
