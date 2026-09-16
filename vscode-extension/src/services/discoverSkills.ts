import {
  WORKSPACE_DATA_DIR,
  SKILLS_DIR,
  loadSkillsFromRoot,
  mergeSkills,
  type AgentSkill,
} from '@my-agent-editor/shared';
import type { ConfigService } from './ConfigService';
import type { VscodeFileService } from './VscodeFileService';

function joinRoot(root: string, ...parts: string[]): string {
  const base = root.replace(/\\/g, '/').replace(/\/$/, '');
  return [base, ...parts.map((p) => p.replace(/^\/+|\/+$/g, ''))].join('/');
}

/** 发现工作区与用户级 skills */
export async function discoverSkills(
  fileService: VscodeFileService,
  configService: ConfigService
): Promise<AgentSkill[]> {
  const io = {
    listDeep: (absDir: string) => fileService.listFiles(absDir, true),
    read: (absPath: string) => fileService.read(absPath),
  };

  const userRoot = configService.getUserRoot();
  const userSkills = userRoot
    ? await loadSkillsFromRoot(joinRoot(userRoot, SKILLS_DIR), 'user', io)
    : [];

  const ws = fileService.getWorkspaceRoot().trim();
  const workspaceSkills = ws
    ? await loadSkillsFromRoot(
        joinRoot(ws, WORKSPACE_DATA_DIR, SKILLS_DIR),
        'workspace',
        io
      )
    : [];

  return mergeSkills(userSkills, workspaceSkills);
}
