export function isAbsolutePath(path: string): boolean {
  return /^([A-Za-z]:[\\/]|\/)/.test(path);
}

export function joinPath(base: string, name: string): string {
  const normalizedBase = base.replace(/\\/g, '/').replace(/\/$/, '');
  return `${normalizedBase}/${name}`;
}

export function resolvePath(path: string, workspaceRoot: string): string {
  if (isAbsolutePath(path)) return path;
  if (workspaceRoot) {
    const sep = workspaceRoot.endsWith('\\') || workspaceRoot.endsWith('/') ? '' : '/';
    return `${workspaceRoot}${sep}${path.replace(/\\/g, '/')}`;
  }
  return path;
}

export function normalizeWorkspaceRoot(root: string): string {
  return root.replace(/\\/g, '/').replace(/\/$/, '');
}

export function resolveListDir(path: string, workspaceRoot: string): string {
  const trimmed = path.trim().replace(/\\/g, '/').replace(/\/\.$/, '');
  if (!trimmed || trimmed === '.') {
    if (workspaceRoot) return normalizeWorkspaceRoot(workspaceRoot);
    return '.';
  }
  if (isAbsolutePath(trimmed)) {
    return trimmed.replace(/\/$/, '');
  }
  return resolvePath(trimmed, workspaceRoot);
}

export function getParentDir(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  if (idx <= 0) return '';
  return normalized.slice(0, idx);
}

/** 将绝对路径转为相对工作区的路径，无法转换时原样返回 */
export function toRelativePath(path: string, workspaceRoot: string): string {
  if (!path) return path;
  const normalized = path.replace(/\\/g, '/');
  if (!workspaceRoot) return normalized;
  if (!isAbsolutePath(normalized)) return normalized.replace(/^\.\//, '');

  const root = normalizeWorkspaceRoot(workspaceRoot);
  const pathLower = normalized.toLowerCase();
  const rootLower = root.toLowerCase();
  if (pathLower === rootLower) return '.';
  if (pathLower.startsWith(rootLower + '/')) {
    return normalized.slice(root.length + 1);
  }
  return normalized;
}
