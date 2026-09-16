import type { AgentToolDefinition } from './types.js';

export const readSkillTool: AgentToolDefinition = {
  name: 'read_skill',
  description: '按名称读取 Skill 全文',
  args: [
    {
      name: 'name',
      description: 'Skill 名称（与 SKILL.md frontmatter 的 name 一致）',
    },
  ],
  action: 'read_skill',
  parseArgs(args) {
    const name = args.name?.trim();
    if (!name) return null;
    return { action: 'read_skill', path: name };
  },
  toArgs(operation) {
    return { name: operation.path };
  },
};
