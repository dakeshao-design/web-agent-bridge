# VS Code 扩展迁移指南

`packages/shared` 不依赖 Tauri / VS Code API。扩展直接 import shared，仅替换文件 IO 与 Agent 桥接层。

## 架构

侧栏 `WebviewView` 提供 AgentPanel 对话 UI；真实 Agent 站点由 **静默 Agent Host**（`AGENT_HOST=1` 的 editor-app / WebView2）承载，经本机 HTTP IPC 通信。不打开系统浏览器。

```
VS Code Sidebar  ←postMessage→  Extension Host  ←HTTP :9791→  Agent Host (WebView2)
```

## 接口对应表

| 本期组件 | VS Code 替代方案 |
|---|---|
| `config/agents.json` | `%APPDATA%/agent-editor/config/agents.json`（首次从 templates 复制） |
| `config/app.config.json` | 同上目录；少量项可用 `webAgentBridge.*` settings |
| `ConfigLoader` | `vscode.workspace.createFileSystemWatcher` + `workspace.fs` |
| `FileOperationParser` / `CallToolParser` | 直接 import `@my-agent-editor/shared` |
| `TauriFileService` | `VscodeFileService`（`vscode.workspace.fs`） |
| `WebViewAgentBridge` | `AgentHostBridge` + `AgentHostProcess` |
| `scripts/*-bridge.js` | 用户目录 `scripts/`，由 Host 注入 WebView2 |

## 安装后配置 Agent

1. 命令 **WebAgent Bridge: Open Agents Config** 打开 `agents.json`
2. 启用/禁用 Agent、改 `url` / `inputMode` / `injectScript`
3. 新站点：复制 `_bridge-template.js`，在 JSON 中增加条目
4. 保存后热重载；侧栏点「登录」完成网页登录后可「隐藏」

## 本地开发

```bash
pnpm install
pnpm --filter @my-agent-editor/shared build
pnpm --filter webagent-bridge compile
# 可选：先启动 Host
pnpm agent-host
# 然后在 VS Code 中：运行和调试 → 启动「Extension」
```

扩展会尝试拉起已构建的 `editor-app.exe`（debug/release），或开发态下 `pnpm exec tauri dev`（需较长时间）。

## 打包 VSIX

```bash
pnpm --filter webagent-bridge copy-templates
pnpm --filter editor-app exec tauri build
# 将 release 二进制复制为 vscode-extension/bin/agent-host.exe
pnpm --filter webagent-bridge compile
cd vscode-extension && npx @vscode/vsce package --no-dependencies
```

## 迁移检查清单

- [x] `packages/shared` 加入扩展 dependencies（esbuild 打包）
- [x] 实现 `VscodeFileService`
- [x] 实现 `AgentHostBridge` / 静默 Host IPC
- [x] 编辑器使用 VS Code 内置编辑器
- [x] 文件操作确认改用 `showWarningMessage`
- [x] `contributes.keybindings` 注册快捷键
- [x] 侧栏 AgentPanel + 登录显隐
