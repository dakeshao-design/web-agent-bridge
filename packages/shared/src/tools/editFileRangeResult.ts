export type EditFileRangeResultMeta = {
  total_lines: number;
  edited_range?: string;
  deleted_range?: string;
  logMessage: string;
};

function formatRange(start: number, end: number): string {
  return start === end ? String(start) : `${start}-${end}`;
}

/** 根据替换结果生成回传字段与日志文案 */
export function buildEditFileRangeResultMeta(
  startLine: number,
  endLine: number,
  replacementLineCount: number,
  totalLines: number
): EditFileRangeResultMeta {
  if (replacementLineCount <= 0) {
    const deleted_range = `${startLine}-${endLine}`;
    return {
      total_lines: totalLines,
      deleted_range,
      logMessage: `总行数 ${totalLines}，已删除 ${deleted_range}`,
    };
  }

  const newEnd = startLine + replacementLineCount - 1;
  const edited_range = formatRange(startLine, newEnd);
  return {
    total_lines: totalLines,
    edited_range,
    logMessage: `总行数 ${totalLines}，新内容 ${edited_range}`,
  };
}
