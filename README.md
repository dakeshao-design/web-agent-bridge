# Web Agent Bridge

Bridge web AI chat sites to local files from **VS Code** (WAB) or a **Tauri** desktop debugger (WABEditor).

```
VS Code sidebar → Extension Host → Agent Host (WebView2) → site scripts
```

## Requirements

- Windows + WebView2
- Node.js >= 18
- pnpm
- Rust / Tauri toolchain (desktop & host)

## Quick start

```bash
pnpm install
pnpm build
```

**VS Code extension (main entry)**

```bash
pnpm --filter @my-agent-editor/shared build
pnpm --filter webagent-bridge copy-templates
pnpm ext:compile
```

Open this repo in VS Code / Cursor and press **F5**.

**Desktop debugger**

```bash
pnpm tauri dev
```

## Site config

User config at runtime: `%USERPROFILE%\.web-agent-bridge\` (`config/` + `scripts/`).

To add a site: copy the JS sample from `scripts/_bridge-template.md` to `scripts/xxx-bridge.js`, fill the `==BridgeScript==` header and site adapters.

## Skills

Put `SKILL.md` under:

- Workspace: `{workspace}/.web-aget-bridge/skills/<name>/`
- User: `%USERPROFILE%\.web-agent-bridge\skills\<name>\`

Frontmatter: `name`, `description`, optional `inject` (`auto` | `always` | `none`). Agent loads via `read_skill` by name. Workspace wins on name clash. If `read_skill` is denied, skills are not disclosed.

## Layout

```
packages/shared/        # shared bridge & tools
packages/editor-app/    # WABEditor (Tauri)
packages/agent-host/    # silent WebView2 host
vscode-extension/       # WAB
scripts/                # bridge runtime + helpers
config/                 # app defaults / templates
```

## License

Private / unpublished unless stated otherwise.
