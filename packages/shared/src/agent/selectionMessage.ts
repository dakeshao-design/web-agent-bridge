export type SelectionMessageInput = {
  path?: string | null;
  startLine: number;
  endLine: number;
  text: string;
};

/** 选区注入消息：路径 + 行号/行范围 + 代码块 */
export function buildSelectionMessage(input: SelectionMessageInput): string {
  const start = Math.max(1, Math.min(input.startLine, input.endLine));
  const end = Math.max(1, Math.max(input.startLine, input.endLine));
  const linePart = start === end ? `行: ${start}` : `行: ${start}-${end}`;
  const path = input.path?.trim();
  const header = path ? `文件: ${path}\n${linePart}\n\n` : `${linePart}\n\n`;
  return `${header}\`\`\`\n${input.text}\n\`\`\``;
}
