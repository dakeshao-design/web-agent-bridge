import type { AgentToolDefinition } from '../tools/types.js';
import type { ToolPermissionsConfig } from '../config/types.js';
import { AGENT_TOOLS } from '../tools/registry.js';
import { listToolsForPrompt } from './toolPermissions.js';

/** 外层围栏用 6 个反引号，避免 content 内 ``` 提前闭合 */
export const AGENT_MODE_TOOL_FORMAT = `\`\`\`\`\`\`call-tool
BEGIN_TOOL: toolName
BEGIN_ARG: param1
value1
END_ARG
BEGIN_ARG: param2
value2
END_ARG
END_TOOL
\`\`\`\`\`\``;

export function formatToolArgs(tool: AgentToolDefinition): string {
  return tool.args.map((arg) => `${arg.name}: ${arg.description}`).join('；');
}

export function buildToolTable(tools: readonly AgentToolDefinition[] = AGENT_TOOLS): string {
  const header = '| 工具名 | 说明 | 参数 |';
  const separator = '|--------|------|------|';
  const rows = tools.map(
    (tool) => `| ${tool.name} | ${tool.description} | ${formatToolArgs(tool)} |`
  );
  return [header, separator, ...rows].join('\n');
}

function buildFileLineLimitSection(fileLineLimit: number): string {
  return `
## 文件行数上限（${fileLineLimit} 行）

- 单次 \`write_file\` / \`append_file\` / \`edit_file_range\` 的 content 建议不超过 **${fileLineLimit} 行**，只在换行处拆分
- 大文件：先 \`write_file\` 写第 1 段，再多次 \`append_file\`；每轮只调用一个工具并等待结果
- \`read_file\`：整文件可能超过 ${fileLineLimit} 行时，先 \`count_file_rows\`，再用 \`read_file_range\` 分段读，单次 range 不超过 ${fileLineLimit} 行
- 若输出被截断且没有完整 \`END_TOOL\`，表示**未落盘**；须从小块 \`write_file\` 重新分片，不能从中间 \`append\`
`;
}

export function buildAgentModePrompt(
  workspaceRoot?: string,
  fileLineLimit?: number,
  toolPermissions?: ToolPermissionsConfig | null
): string {
  void workspaceRoot;
  const tools = listToolsForPrompt(toolPermissions);
  const limitSection =
    fileLineLimit != null && fileLineLimit > 0
      ? buildFileLineLimitSection(fileLineLimit)
      : '';

  return `你当前处于 **Agent 模式**。编辑器会解析你回复中的工具调用并执行本地文件操作。

## 可用工具

${buildToolTable(tools)}

## 调用格式

使用 \`call-tool\` 代码块，结构如下：

${AGENT_MODE_TOOL_FORMAT}

## 调用规则

- 外层围栏须使用 **至少 6 个反引号**，且须 **长于** content 内任何代码围栏，避免站点 Markdown 提前截断
- **每次回复只调用一个工具**，不要在同一条回复中输出多个 \`call-tool\` 代码块
- 等待编辑器回传该工具的执行结果后，再根据结果决定下一步是否继续调用工具
${limitSection}
## 示例

\`\`\`\`\`\`call-tool
BEGIN_TOOL: write_file
BEGIN_ARG: path
docs/guide.md
END_ARG
BEGIN_ARG: content
# 指南

示例：

\`\`\`js
console.log(1)
\`\`\`
END_ARG
END_TOOL
\`\`\`\`\`\`

请根据用户需求，在需要操作本地文件时按上述格式输出工具调用。

本轮不要回答，等待用户输入。`;
}
