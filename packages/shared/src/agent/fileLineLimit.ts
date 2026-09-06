/** 从站点 bridge 脚本解析读写行限；优先头注释，其次旧常量/注册字段 */
export type FileLineLimits = {
  read?: number;
  write?: number;
};

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return n;
}

function parseHeaderTag(source: string, tag: string): string | undefined {
  const block = source.match(/\/\/\s*==BridgeScript==\s*([\s\S]*?)\/\/\s*==\/BridgeScript==/);
  if (!block) return undefined;
  const re = new RegExp(String.raw`\/\/\s*@${tag}\s+(\S+)`, 'i');
  const m = block[1].match(re);
  return m?.[1];
}

export function parseFileLineLimitsFromBridgeScript(source: string): FileLineLimits {
  const read =
    parsePositiveInt(parseHeaderTag(source, 'readFileLineLimit')) ??
    parsePositiveInt(source.match(/\bREAD_FILE_LINE_LIMIT\s*=\s*(\d+)/)?.[1]) ??
    parsePositiveInt(source.match(/\breadFileLineLimit\s*:\s*(\d+)/)?.[1]);
  const write =
    parsePositiveInt(parseHeaderTag(source, 'writeFileLineLimit')) ??
    parsePositiveInt(source.match(/\bWRITE_FILE_LINE_LIMIT\s*=\s*(\d+)/)?.[1]) ??
    parsePositiveInt(source.match(/\bwriteFileLineLimit\s*:\s*(\d+)/)?.[1]);
  return { read, write };
}

/** 解析可选 SITE_AGENT_PROMPT；空白视为未声明 */
export function parseSiteAgentPromptFromBridgeScript(source: string): string | undefined {
  const m = source.match(
    /\bSITE_AGENT_PROMPT\s*=\s*(?:`([\s\S]*?)`|"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')/
  );
  if (!m) return undefined;
  let raw = m[1] ?? m[2] ?? m[3] ?? '';
  if (m[2] != null || m[3] != null) {
    raw = raw.replace(/\\([\\'"nrt])/g, (_, ch: string) => {
      if (ch === 'n') return '\n';
      if (ch === 'r') return '\r';
      if (ch === 't') return '\t';
      return ch;
    });
  }
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
}

/** 与 read_file 一致的行数统计 */
export function countContentLines(content: string): number {
  if (content.length === 0) return 0;
  return content.split(/\r?\n/).length;
}

export function buildReadFileOverLimitMessage(totalLines: number, limit: number): string {
  return `文件共 ${totalLines} 行，超过上限 ${limit} 行。请使用 read_file_range 分段读取。`;
}
