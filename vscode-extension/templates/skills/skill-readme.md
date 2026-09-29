# Skills 规范

Skill 是给 Agent 用的专用工作流说明：Markdown 文件，经发现与注入后进入提示词，或由 Agent 按需用 `read_skill` 读取全文。

本目录仅作规范与示例存放；运行时不会扫描仓库根下的 `skills/`。

## 存放位置

| 范围 | 路径 |
|------|------|
| 工作区 | `{workspace}/.web-aget-bridge/skills/<name>/SKILL.md` |
| 用户级 | `%USERPROFILE%\.web-agent-bridge\skills\<name>\SKILL.md` |

规则：

- 递归发现上述根目录下任意子目录中的 `SKILL.md`（文件名大小写不敏感）
- 同名时工作区覆盖用户级
- `toolPermissions.read_skill` 为 `deny` 时：不披露任何 skill，且不可调用 `read_skill`

## 目录约定

推荐每个 skill 单独一目录：

```
.web-aget-bridge/skills/   # 或用户级 …\.web-agent-bridge\skills\
└── my-workflow/
    ├── SKILL.md           # 必填
    ├── reference/         # 可选，细节参考
    ├── examples/          # 可选，示例
    └── scripts/           # 可选，辅助脚本
```

见本仓库 [`my-workflow/SKILL.md`](my-workflow/SKILL.md)。正文里引用附属文件用相对路径，一层链接即可。

## SKILL.md 格式

须含 YAML frontmatter 与 Markdown 正文：

```markdown
---
name: my-workflow
description: 简述能力与适用场景。在用户提到某某任务时使用。
inject: auto
---

# 标题

## 步骤
1. …
2. …
```

### frontmatter

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | 是 | Skill 唯一名称；`read_skill` 的 `name` 参数与此一致 |
| `description` | 是 | 能力与触发场景；`inject: auto` 时写入提示词目录表 |
| `inject` | 否 | `auto`（默认）/ `always` / `manual` |

缺 `name` 或 `description`、或无合法 frontmatter 的文件会被跳过。

### inject

| 值 | 行为 |
|----|------|
| `auto` | 初始提示词只披露名称与说明；相关时用 `read_skill` 读正文 |
| `always` | 正文写入初始提示词，无需再读 |
| `manual` | 不披露名称/说明；仍可按名称 `read_skill` |

非法取值按 `auto` 处理。

## 工具：`read_skill`

| 参数 | 说明 |
|------|------|
| `name` | 与 frontmatter 的 `name` 一致 |

返回去 frontmatter 后的正文。不要一次加载全部 skill。

## 编写要点

- `description` 写清 **做什么** 与 **何时用**，便于 Agent 判断是否相关
- 正文只写 Agent 不知道的领域步骤与约定；避免冗长背景
- `inject: always` 仅用于短且几乎每次都要遵守的规则
- 长参考放到附属文件，由正文指引何时再读

## 最小示例

```markdown
---
name: commit-message
description: 按仓库约定从 diff 生成提交说明。在用户要求写 commit message 或整理暂存变更说明时使用。
inject: auto
---

# 提交说明

1. 查看暂存 diff
2. 用一行概括意图，必要时补正文说明「为什么」
3. 不罗列文件清单式变更
```
