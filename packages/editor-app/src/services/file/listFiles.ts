import { WORKSPACE_DATA_DIR } from '@my-agent-editor/shared';
import { readDir, BaseDirectory } from '@tauri-apps/plugin-fs';
import { joinPath } from './pathUtils';
import { HIDDEN_ENTRIES } from './fileTree';

async function readDirEntries(dir: string, isAbsolute: boolean) {
  return isAbsolute
    ? readDir(dir)
    : readDir(dir, { baseDir: BaseDirectory.AppData });
}

function shouldSkipEntry(name: string, skipWorkspaceDataDir: boolean): boolean {
  if (HIDDEN_ENTRIES.has(name)) return true;
  return skipWorkspaceDataDir && name === WORKSPACE_DATA_DIR;
}

export async function listFilesInDir(
  dir: string,
  isAbsolute: boolean,
  deep: boolean,
  skipWorkspaceDataDir = false
): Promise<string[]> {
  if (!deep) {
    const entries = await readDirEntries(dir, isAbsolute);
    return entries
      .filter(
        (entry) =>
          (entry.isFile || entry.isDirectory) &&
          !shouldSkipEntry(entry.name, skipWorkspaceDataDir)
      )
      .map((entry) => (entry.isDirectory ? `${entry.name}/` : entry.name))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }

  const files: string[] = [];

  async function walk(currentDir: string, prefix: string): Promise<void> {
    const entries = await readDirEntries(currentDir, isAbsolute);
    const sorted = [...entries].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );

    for (const entry of sorted) {
      if (shouldSkipEntry(entry.name, skipWorkspaceDataDir)) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isFile) {
        files.push(rel);
        continue;
      }
      if (entry.isDirectory) {
        await walk(joinPath(currentDir, entry.name), rel);
      }
    }
  }

  await walk(dir, '');
  return files;
}
