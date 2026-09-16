export type EditFileReplacement = {
  old: string;
  new: string;
};

export type EditFileLogicResult = {
  next: string;
  total_lines: number;
  edited_range?: string;
  deleted_range?: string;
  logMessage: string;
};

type MatchSpan = {
  index: number;
  start: number;
  oldLineCount: number;
  newLines: string[];
};

function splitLines(text: string): string[] {
  if (text === '') return [];
  return text.split(/\r?\n/);
}

function formatRange(start: number, end: number): string {
  return start === end ? String(start) : `${start}-${end}`;
}

function findUniqueMatch(lines: string[], oldLines: string[], pairIndex: number): number {
  if (oldLines.length === 0) {
    throw new Error(`old_${pairIndex} 不能为空`);
  }
  const matches: number[] = [];
  const maxStart = lines.length - oldLines.length;
  for (let i = 0; i <= maxStart; i++) {
    let ok = true;
    for (let j = 0; j < oldLines.length; j++) {
      if (lines[i + j] !== oldLines[j]) {
        ok = false;
        break;
      }
    }
    if (ok) matches.push(i);
  }
  if (matches.length === 0) {
    throw new Error(`old_${pairIndex} 未匹配到任何整行段落`);
  }
  if (matches.length > 1) {
    throw new Error(`old_${pairIndex} 匹配到 ${matches.length} 处，要求唯一`);
  }
  return matches[0];
}

/** 按整行对齐替换；匹配 0/多处或区间重叠则抛错 */
export function applyEditFileReplacements(
  fileContent: string,
  replacements: EditFileReplacement[]
): EditFileLogicResult {
  if (replacements.length === 0) {
    throw new Error('至少需要一对 old_1/new_1');
  }

  const lines = splitLines(fileContent);
  const spans: MatchSpan[] = [];

  for (let i = 0; i < replacements.length; i++) {
    const pairIndex = i + 1;
    const oldLines = splitLines(replacements[i].old);
    const newLines = splitLines(replacements[i].new);
    const start = findUniqueMatch(lines, oldLines, pairIndex);
    spans.push({
      index: pairIndex,
      start,
      oldLineCount: oldLines.length,
      newLines,
    });
  }

  spans.sort((a, b) => a.start - b.start);
  for (let i = 1; i < spans.length; i++) {
    const prev = spans[i - 1];
    const cur = spans[i];
    const prevEnd = prev.start + prev.oldLineCount;
    if (cur.start < prevEnd) {
      throw new Error(`old_${prev.index} 与 old_${cur.index} 匹配区间重叠`);
    }
  }

  const editedParts: string[] = [];
  const deletedParts: string[] = [];
  let lineDelta = 0;
  for (const span of spans) {
    const finalStart = span.start + lineDelta;
    const finalStartLine = finalStart + 1;
    if (span.newLines.length === 0) {
      const oldEndLine = finalStartLine + span.oldLineCount - 1;
      deletedParts.push(`${finalStartLine}-${oldEndLine}`);
    } else {
      const newEnd = finalStartLine + span.newLines.length - 1;
      editedParts.push(formatRange(finalStartLine, newEnd));
    }
    lineDelta += span.newLines.length - span.oldLineCount;
  }

  // 从后往前替换，避免行号偏移
  const ordered = [...spans].sort((a, b) => b.start - a.start);
  for (const span of ordered) {
    lines.splice(span.start, span.oldLineCount, ...span.newLines);
  }

  const total_lines = lines.length;
  const edited_range = editedParts.length > 0 ? editedParts.join(',') : undefined;
  const deleted_range = deletedParts.length > 0 ? deletedParts.join(',') : undefined;
  const parts: string[] = [`总行数 ${total_lines}`];
  if (edited_range) parts.push(`新内容 ${edited_range}`);
  if (deleted_range) parts.push(`已删除 ${deleted_range}`);

  return {
    next: lines.join('\n'),
    total_lines,
    edited_range,
    deleted_range,
    logMessage: parts.join('，'),
  };
}
