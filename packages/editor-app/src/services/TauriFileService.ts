import { invoke } from '@tauri-apps/api/core';

import { readTextFile, writeTextFile, remove, BaseDirectory } from '@tauri-apps/plugin-fs';
import { open, save } from '@tauri-apps/plugin-dialog';
import type { IFileService } from '@my-agent-editor/shared';
import { isAbsolutePath, resolvePath, normalizeWorkspaceRoot, resolveListDir } from './file/pathUtils';
import { listDirectoryEntries, type FileTreeEntry } from './file/fileTree';
import { ensureParentDir } from './file/ensureParentDir';
import { listFilesInDir } from './file/listFiles';
import { copyPathFs, movePathFs } from './file/copyMove';



export type { FileTreeEntry };



export class TauriFileService implements IFileService {

  private workspaceRoot: string;



  constructor(workspaceRoot = '') {

    this.workspaceRoot = workspaceRoot;

  }



  setWorkspaceRoot(root: string): void {

    this.workspaceRoot = normalizeWorkspaceRoot(root);

  }



  getWorkspaceRoot(): string {

    return this.workspaceRoot;

  }



  async listDirectory(dir: string): Promise<FileTreeEntry[]> {

    const resolved = this.resolvePath(dir);

    return listDirectoryEntries(resolved, isAbsolutePath(resolved));

  }



  async openFolderDialog(): Promise<string | null> {

    const selected = await open({

      directory: true,

      multiple: false,

    });

    if (!selected || typeof selected !== 'string') return null;

    this.setWorkspaceRoot(selected);

    return selected;

  }



  async readFile(path: string): Promise<string> {

    return this.read(path);

  }



  async read(path: string): Promise<string> {

    const resolved = this.resolvePath(path);

    if (isAbsolutePath(resolved)) {

      return readTextFile(resolved);

    }

    return readTextFile(resolved, { baseDir: BaseDirectory.AppData });

  }



  async write(path: string, content: string): Promise<void> {
    const resolved = this.resolvePath(path);
    await ensureParentDir(resolved);
    if (isAbsolutePath(resolved)) {
      await writeTextFile(resolved, content);
      return;
    }
    await writeTextFile(resolved, content, { baseDir: BaseDirectory.AppData });
  }



  async append(path: string, content: string): Promise<void> {
    const resolved = this.resolvePath(path);
    await ensureParentDir(resolved);
    if (isAbsolutePath(resolved)) {
      await writeTextFile(resolved, content, { append: true });
      return;
    }
    await writeTextFile(resolved, content, { append: true, baseDir: BaseDirectory.AppData });
  }



  async delete(path: string): Promise<void> {

    const resolved = this.resolvePath(path);

    if (isAbsolutePath(resolved)) {

      await remove(resolved);

      return;

    }

    await remove(resolved, { baseDir: BaseDirectory.AppData });

  }



  async deletePath(path: string): Promise<void> {

    const resolved = this.resolvePath(path);

    if (isAbsolutePath(resolved)) {

      await remove(resolved, { recursive: true });

      return;

    }

    await remove(resolved, { recursive: true, baseDir: BaseDirectory.AppData });

  }

  async move(from: string, to: string): Promise<void> {
    const src = this.resolvePath(from);
    const dest = this.resolvePath(to);
    await movePathFs(src, dest);
  }

  async copy(from: string, to: string): Promise<void> {
    const src = this.resolvePath(from);
    const dest = this.resolvePath(to);
    await copyPathFs(src, dest);
  }

  async list(dir: string): Promise<string[]> {
    return this.listFiles(dir, false);
  }

  async listFiles(dir: string, deep = false): Promise<string[]> {
    const resolved = resolveListDir(dir, this.workspaceRoot);
    const isAbsolute = isAbsolutePath(resolved);
    return listFilesInDir(resolved, isAbsolute, deep);
  }



  async openFileDialog(): Promise<{ path: string; content: string } | null> {

    const selected = await open({
      multiple: false,
    });

    if (!selected || typeof selected !== 'string') return null;

    const content = await readTextFile(selected);

    return { path: selected, content };
  }



  async saveFileDialog(path: string | null, content: string): Promise<string | null> {

    if (path) {

      await writeTextFile(path, content);

      return path;

    }

    const selected = await save({});

    if (!selected) return null;

    await writeTextFile(selected, content);

    return selected;

  }



  async saveAsDialog(content: string): Promise<string | null> {

    return this.saveFileDialog(null, content);

  }



  async readConfigFile(relativePath: string): Promise<string> {

    return invoke<string>('read_config_file', { relativePath });

  }

  async writeConfigFile(relativePath: string, content: string): Promise<void> {
    await invoke('write_config_file', { relativePath, content });
  }

  async readBridgeScript(relativePath: string): Promise<string> {
    return invoke<string>('read_bridge_script', { relativePath });
  }

  async listBridgeScripts(): Promise<{ relativePath: string; content: string }[]> {
    return invoke('list_bridge_scripts');
  }

  async appendLog(path: string, content: string): Promise<void> {
    const resolved = this.resolvePath(path);
    if (isAbsolutePath(resolved)) {
      await ensureParentDir(resolved);
      await writeTextFile(resolved, content, { append: true });
      return;
    }
    await ensureParentDir(resolved);
    await writeTextFile(resolved, content, { append: true, baseDir: BaseDirectory.AppData });
  }



  private resolvePath(path: string): string {

    return resolvePath(path, this.workspaceRoot);

  }

}


