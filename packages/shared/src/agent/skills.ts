/** Skill 注入方式 */
export type SkillInjectMode = 'auto' | 'always' | 'none';

export type SkillSource = 'workspace' | 'user';

export interface AgentSkill {
  name: string;
  description: string;
  inject: SkillInjectMode;
  /** 去 frontmatter 后的正文 */
  body: string;
  source: SkillSource;
  /** 宿主解析用绝对路径，不写入提示词目录表 */
  filePath: string;
}

export interface ParsedSkillMd {
  name: string;
  description: string;
  inject: SkillInjectMode;
  body: string;
}

export interface DiscoverSkillsIO {
  listDeep: (absDir: string) => Promise<string[]>;
  read: (absPath: string) => Promise<string>;
}

function parseInject(raw: string | undefined): SkillInjectMode {
  const v = (raw ?? 'auto').trim().toLowerCase();
  if (v === 'always' || v === 'none' || v === 'auto') return v;
  return 'auto';
}

function unquote(value: string): string {
  const t = value.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1).trim();
  }
  return t;
}

function joinAbs(root: string, rel: string): string {
  const r = root.replace(/\\/g, '/').replace(/\/$/, '');
  const p = rel.replace(/\\/g, '/').replace(/^\.\//, '');
  return `${r}/${p}`;
}

function isSkillMdPath(rel: string): boolean {
  const n = rel.replace(/\\/g, '/');
  const base = n.includes('/') ? n.slice(n.lastIndexOf('/') + 1) : n;
  return base.toLowerCase() === 'skill.md';
}

/** 解析 SKILL.md：YAML frontmatter + 正文 */
export function parseSkillMd(content: string): ParsedSkillMd | null {
  const text = content.replace(/^\uFEFF/, '');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;

  const fm = match[1];
  const body = match[2].replace(/^\r?\n/, '');
  const fields: Record<string, string> = {};

  for (const line of fm.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon <= 0) continue;
    const key = trimmed.slice(0, colon).trim().toLowerCase();
    const value = unquote(trimmed.slice(colon + 1));
    fields[key] = value;
  }

  const name = fields.name?.trim();
  const description = fields.description?.trim();
  if (!name || !description) return null;

  return {
    name,
    description,
    inject: parseInject(fields.inject),
    body,
  };
}

/** 从单个 skills 根目录加载 */
export async function loadSkillsFromRoot(
  skillsRoot: string,
  source: SkillSource,
  io: DiscoverSkillsIO
): Promise<AgentSkill[]> {
  const root = skillsRoot.replace(/\\/g, '/').replace(/\/$/, '');
  if (!root) return [];

  let rels: string[] = [];
  try {
    rels = await io.listDeep(root);
  } catch {
    return [];
  }

  const out: AgentSkill[] = [];
  for (const rel of rels) {
    if (!isSkillMdPath(rel)) continue;
    const filePath = joinAbs(root, rel);
    try {
      const content = await io.read(filePath);
      const parsed = parseSkillMd(content);
      if (!parsed) continue;
      out.push({
        name: parsed.name,
        description: parsed.description,
        inject: parsed.inject,
        body: parsed.body,
        source,
        filePath,
      });
    } catch {
      // 单个 skill 失败则跳过
    }
  }
  return out;
}

/** 同名时 workspace 覆盖 user */
export function mergeSkills(
  user: readonly AgentSkill[],
  workspace: readonly AgentSkill[]
): AgentSkill[] {
  const map = new Map<string, AgentSkill>();
  for (const skill of user) {
    map.set(skill.name, skill);
  }
  for (const skill of workspace) {
    map.set(skill.name, skill);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function findSkillByName(
  skills: readonly AgentSkill[],
  name: string
): AgentSkill | undefined {
  return skills.find((s) => s.name === name);
}

/** Agent 提示词中的 Skills 段落 */
export function buildSkillsPromptSection(skills: readonly AgentSkill[]): string {
  if (!skills.length) return '';

  const autoSkills = skills.filter((s) => s.inject === 'auto');
  const alwaysSkills = skills.filter((s) => s.inject === 'always');
  if (!autoSkills.length && !alwaysSkills.length) return '';

  const parts: string[] = ['## 可用 Skills', ''];

  if (autoSkills.length) {
    parts.push('| 名称 | 说明 |', '|------|------|');
    for (const skill of autoSkills) {
      const desc = skill.description.replace(/\|/g, '\\|');
      parts.push(`| ${skill.name} | ${desc} |`);
    }
    parts.push('');
  }

  parts.push(
    '- 与任务相关时，使用 `read_skill`（参数 `name` 为 skill 名称）读取全文并遵循其指示。',
    '- 不要一次加载全部 skill。',
    '- `inject: always` 已写入下方的无需再读。',
    ''
  );

  if (alwaysSkills.length) {
    parts.push('## 已注入 Skills', '');
    for (const skill of alwaysSkills) {
      parts.push(`### ${skill.name}`, '', skill.body.trimEnd(), '');
    }
  }

  return parts.join('\n').trimEnd();
}
