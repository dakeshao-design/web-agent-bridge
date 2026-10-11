# WAB - Web Agent Bridge

在 VS Code 侧栏嵌入网页 Agent，通过桥接协议读写工作区文件。

## 功能

- 侧栏 WAB 面板：多 Agent、对话、发送当前文件 / 选区
- 静默 Agent Host（WebView2），无需系统浏览器
- 配置与脚本热重载；危险操作需确认

## 要求

- Windows + WebView2
- VS Code ≥ 1.85

## 使用

1. 安装后打开活动栏 **WAB**
2. 在 `%USERPROFILE%\.web-agent-bridge\` 配置 Agent（`config/`、`scripts/`、`skills/`）
3. 侧栏登录网页 Agent 后即可对话

快捷键：`Ctrl+Alt+F` 发送当前文件，`Ctrl+Alt+S` 发送选区。命令面板前缀：`WAB:`。

## 设置

| 项 | 默认 | 说明 |
|---|---|---|
| `webAgentBridge.hostPort` | `9791` | Agent Host 端口 |
| `webAgentBridge.hostToken` | `dev-token` | 鉴权 token |
| `webAgentBridge.autoStartHost` | `true` | 激活时自动启动 Host |
