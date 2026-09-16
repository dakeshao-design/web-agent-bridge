import {
  WORKSPACE_DATA_DIR,
  SKILLS_DIR,
  loadSkillsFromRoot,
  mergeSkills,
  type AgentSkill,
  type IFileService,
} from '@my-agent-editor/shared';
import { invoke } from '@tauri-apps/api/core';

function joinRoot(root: string, ...parts: string[]): string {
  const base = root.replace(/\\/g, '/').replace(/\/$/, '');
  return [base, ...parts.map((p) => p.replace(/^\/+|\/+$/g, ''))].join('/');
}

async function getUserConfigRoot(): Promise<string> {
  try {
    return await invoke<string>('get_user_config_root');
  } catch {
    return '';
  }
}

/** 发现工作区与用户级 skills，并缓存结果 */
export async function discoverSkills(
  fileService: IFileService,
  workspaceRoot?: string | null
): Promise<AgentSkill[]> {
  const io = {
    listDeep: (absDir: string) => fileService.listFiles(absDir, true),
    read: (absPath: string) => fileService.read(absPath),
  };

  const userRoot = await getUserConfigRoot();
  const userSkills = userRoot
    ? await loadSkillsFromRoot(joinRoot(userRoot, SKILLS_DIR), 'user', io)
    : [];

  const ws = (workspaceRoot || '').trim();
  const workspaceSkills = ws
    ? await loadSkillsFromRoot(
        joinRoot(ws, WORKSPACE_DATA_DIR, SKILLS_DIR),
        'workspace',
        io
      )
    : [];

  return mergeSkills(userSkills, workspaceSkills);
}
