import type { FileOperation } from '../interfaces/IFileOperationParser.js';
import type { ToolPermissionMode, ToolPermissionsConfig } from '../config/types.js';
import { AGENT_TOOLS, getToolByAction, getToolByName } from '../tools/registry.js';
import { fileActionToToolName } from './toolResultMessage.js';

/** 默认权限：仅 run_powershell 为 ask，其余 allow */
export const DEFAULT_TOOL_PERMISSIONS: ToolPermissionsConfig = Object.fromEntries(
  AGENT_TOOLS.map((tool) => [
    tool.name,
    tool.name === 'run_powershell' ? ('ask' as const) : ('allow' as const),
  ])
);

export function mergeToolPermissions(
  partial?: ToolPermissionsConfig | null
): ToolPermissionsConfig {
  return { ...DEFAULT_TOOL_PERMISSIONS, ...(partial ?? {}) };
}

export function getConfiguredPermission(
  toolName: string,
  config?: ToolPermissionsConfig | null
): ToolPermissionMode {
  const merged = mergeToolPermissions(config);
  const mode = merged[toolName];
  if (mode === 'allow' || mode === 'ask' || mode === 'deny') return mode;
  return toolName === 'run_powershell' ? 'ask' : 'allow';
}

function normalizePathForCompare(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** 判断绝对路径是否在工作区内 */
export function isPathInsideWorkspace(absPath: string, workspaceRoot: string): boolean {
  const root = normalizePathForCompare(workspaceRoot.trim());
  if (!root) return true;
  const target = normalizePathForCompare(absPath.trim());
  if (!target) return true;
  return target === root || target.startsWith(root + '/');
}

/** 收集操作涉及的路径字段 */
export function collectOperationTargetPaths(op: FileOperation): string[] {
  if (op.action === 'run_powershell') return [];
  const paths: string[] = [];
  if (op.path?.trim()) paths.push(op.path.trim());
  if (op.dest?.trim()) paths.push(op.dest.trim());
  return paths;
}

export function resolveToolNameForOperation(op: FileOperation): string {
  return getToolByAction(op.action)?.name ?? fileActionToToolName(op.action);
}

/**
 * 有效权限：配置为 allow 且目标路径在工作区外时降为 ask。
 * run_powershell 无路径，不降级。
 * options.skipOutsideWorkspaceDowngrade 可关闭区外降级。
 */
export function resolveEffectivePermission(
  toolName: string,
  op: FileOperation,
  workspaceRoot: string,
  config?: ToolPermissionsConfig | null,
  resolvePath?: (p: string) => string,
  options?: { skipOutsideWorkspaceDowngrade?: boolean }
): ToolPermissionMode {
  const configured = getConfiguredPermission(toolName, config);
  if (configured === 'deny' || configured === 'ask') return configured;

  if (options?.skipOutsideWorkspaceDowngrade) return 'allow';

  const targets = collectOperationTargetPaths(op);
  if (targets.length === 0) return 'allow';

  const root = workspaceRoot.trim();
  if (!root) return 'allow';

  for (const raw of targets) {
    const abs = resolvePath ? resolvePath(raw) : raw;
    if (!isPathInsideWorkspace(abs, root)) return 'ask';
  }
  return 'allow';
}

export function buildDeniedToolResult(toolName: string): string {
  return [
    '[REPORT_TOOL]',
    `工具 \`${toolName}\` 执行被拒绝。`,
    '',
    'status: denied',
    `message: 工具 ${toolName} 已被禁止，未执行。`,
  ].join('\n');
}

/** 确认对话框文案：工具名 + 目标路径 */
export function buildPermissionAskMessage(toolName: string, op: FileOperation): string {
  const lines = [`工具: ${toolName}`];
  if (op.action === 'run_powershell') {
    const cmd = (op.command ?? '').trim();
    const preview = cmd.length > 200 ? cmd.slice(0, 200) + '…' : cmd;
    lines.push(`命令: ${preview || '(空)'}`);
  } else {
    if (op.path?.trim()) lines.push(`路径: ${op.path.trim()}`);
    if (op.dest?.trim()) lines.push(`目标: ${op.dest.trim()}`);
  }
  lines.push('', '是否允许执行？');
  return lines.join('\n');
}

export function listToolsForPrompt(config?: ToolPermissionsConfig | null) {
  const merged = mergeToolPermissions(config);
  return AGENT_TOOLS.filter((tool) => getConfiguredPermission(tool.name, merged) !== 'deny');
}

export function listToolsForSettings(): Array<{ name: string; description: string }> {
  return AGENT_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
  }));
}

export function isValidToolPermissionMode(value: unknown): value is ToolPermissionMode {
  return value === 'allow' || value === 'ask' || value === 'deny';
}

export function toolNameExists(name: string): boolean {
  return !!getToolByName(name);
}
