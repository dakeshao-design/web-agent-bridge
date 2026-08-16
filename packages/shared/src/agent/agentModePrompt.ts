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

function buildFileLineLimitSection(readLimit?: number, writeLimit?: number): string {
  const parts: string[] = [];
  if (writeLimit != null && writeLimit > 0) {
    parts.push(
      `- 单次 \`write_file\` / \`append_file\` / \`edit_file_range\` 的 content 不要超过 **${writeLimit} 行**，只在换行处拆分`,
      `- 大文件：先 \`write_file\` 写第 1 段，再多次 \`append_file\`；每轮只调用一个工具并等待结果`,
      `- 若输出被截断且没有完整 \`END_TOOL\`，表示**未落盘**；须从小块 \`write_file\` 重新分片，不能从中间 \`append\``
    );
  }
  if (readLimit != null && readLimit > 0) {
    parts.push(
      `- \`read_file\`：整文件可能超过 ${readLimit} 行时，先 \`count_file_rows\`，再用 \`read_file_range\` 分段读，单次 range 不超过 ${readLimit} 行`
    );
  }
  if (!parts.length) return '';
  return `
## 文件行数上限

${parts.join('\n')}
`;
}

export function buildAgentModePrompt(
  workspaceRoot?: string,
  readFileLineLimit?: number,
  toolPermissions?: ToolPermissionsConfig | null,
  writeFileLineLimit?: number
): string {
  void workspaceRoot;
  const tools = listToolsForPrompt(toolPermissions);
  const limitSection = buildFileLineLimitSection(readFileLineLimit, writeFileLineLimit);

  return `你处于 **Agent 模式** 下，当前工作区只有使用 \`call-tool\` 代码块调用工具才能访问。

如果需要调用工具，严格遵守如下格式回复：

${AGENT_MODE_TOOL_FORMAT}

<tool_use_instructions>

## 可用工具

${buildToolTable(tools)}

## 调用规则

- 请严格遵守精确的语法。不要使用 XML 标签、JSON 对象或任何其他格式调用工具。
- 在回复中只输出 \`call-tool\` 代码块，不要有任何其他内容。
- 始终在新行开始 \`call-tool\` 代码块，不要有任何前导空格或缩进。
- 外层围栏须使用 **至少 6 个反引号**，且须 **长于** content 内任何代码围栏，避免 \`call-tool\` 代码块提前截断。
- **每次回复只调用一个工具**，不要在一条回复中输出多个 \`call-tool\` 代码块。
- 优先使用以当前工作区为根的相对路径，而不是绝对路径。
- 禁止使用未列出的工具。
- 如果需求可以通过列出的工具解决，请使用工具而不是推测。
- 不要对假设的文件执行操作，请使用工具查找相关文件。

${limitSection}
## 示例

\`\`\`\`\`\`call-tool
BEGIN_TOOL: write_file
BEGIN_ARG: path
docs/guide.md
END_ARG
BEGIN_ARG: content
# 指南

输出日志：

\`\`\`js
console.log(1)
\`\`\`
END_ARG
END_TOOL
\`\`\`\`\`\`
</tool_use_instructions>

本轮不要回复，等待用户输入。`;
}
