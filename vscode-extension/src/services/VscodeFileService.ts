import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { WORKSPACE_DATA_DIR, type IFileService } from '@my-agent-editor/shared';

/** ls / 递归列举时跳过的目录名 */
const HIDDEN_ENTRIES = new Set([
  'node_modules',
  '.git',
  'target',
  'dist',
  WORKSPACE_DATA_DIR,
]);

function isAbsolutePath(p: string): boolean {
  return /^([A-Za-z]:[\\/]|\/)/.test(p);
}

export class VscodeFileService implements IFileService {
  private workspaceRoot = '';

  setWorkspaceRoot(root: string): void {
    this.workspaceRoot = root.replace(/\\/g, '/').replace(/\/$/, '');
  }

  getWorkspaceRoot(): string {
    if (this.workspaceRoot) return this.workspaceRoot;
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return folder ? folder.replace(/\\/g, '/').replace(/\/$/, '') : '';
  }

  resolvePath(input: string): string {
    if (isAbsolutePath(input)) return input;
    const root = this.getWorkspaceRoot();
    if (!root) return input;
    const sep = root.endsWith('/') ? '' : '/';
    return `${root}${sep}${input.replace(/\\/g, '/')}`;
  }

  async read(filePath: string): Promise<string> {
    const resolved = this.resolvePath(filePath);
    const uri = vscode.Uri.file(resolved);
    const data = await vscode.workspace.fs.readFile(uri);
    return new TextDecoder().decode(data);
  }

  async write(filePath: string, content: string): Promise<void> {
    const resolved = this.resolvePath(filePath);
    const uri = vscode.Uri.file(resolved);
    const parent = vscode.Uri.file(path.dirname(resolved));
    try {
      await vscode.workspace.fs.stat(parent);
    } catch {
      await vscode.workspace.fs.createDirectory(parent);
    }
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
  }

  async append(filePath: string, content: string): Promise<void> {
    const existing = await this.read(filePath).catch(() => '');
    await this.write(filePath, existing + content);
  }

  async delete(filePath: string): Promise<void> {
    const uri = vscode.Uri.file(this.resolvePath(filePath));
    await vscode.workspace.fs.delete(uri, { useTrash: false });
  }

  async deletePath(filePath: string): Promise<void> {
    const uri = vscode.Uri.file(this.resolvePath(filePath));
    await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: false });
  }

  async move(from: string, to: string): Promise<void> {
    const src = this.resolvePath(from);
    const dest = this.resolvePath(to);
    const destUri = vscode.Uri.file(dest);
    try {
      await vscode.workspace.fs.stat(destUri);
      throw new Error(`目标已存在: ${dest}`);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('目标已存在')) throw err;
    }
    const parent = vscode.Uri.file(path.dirname(dest));
    try {
      await vscode.workspace.fs.stat(parent);
    } catch {
      await vscode.workspace.fs.createDirectory(parent);
    }
    await vscode.workspace.fs.rename(vscode.Uri.file(src), destUri, { overwrite: false });
  }

  async copy(from: string, to: string): Promise<void> {
    const src = this.resolvePath(from);
    const dest = this.resolvePath(to);
    const destUri = vscode.Uri.file(dest);
    try {
      await vscode.workspace.fs.stat(destUri);
      throw new Error(`目标已存在: ${dest}`);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('目标已存在')) throw err;
    }
    const parent = vscode.Uri.file(path.dirname(dest));
    try {
      await vscode.workspace.fs.stat(parent);
    } catch {
      await vscode.workspace.fs.createDirectory(parent);
    }
    await vscode.workspace.fs.copy(vscode.Uri.file(src), destUri, { overwrite: false });
  }

  async list(dir: string): Promise<string[]> {
    const uri = vscode.Uri.file(this.resolvePath(dir));
    const entries = await vscode.workspace.fs.readDirectory(uri);
    return entries
      .filter(([, type]) => type === vscode.FileType.File)
      .map(([name]) => name);
  }

  async listFiles(dir: string, deep = false): Promise<string[]> {
    const resolved = this.resolvePath(dir);
    const root = this.getWorkspaceRoot();
    const results: string[] = [];

    const walk = async (current: string, prefix: string) => {
      const uri = vscode.Uri.file(current);
      let entries: [string, vscode.FileType][];
      try {
        entries = await vscode.workspace.fs.readDirectory(uri);
      } catch {
        return;
      }
      for (const [name, type] of entries) {
        if (HIDDEN_ENTRIES.has(name)) continue;
        const rel = prefix ? `${prefix}/${name}` : name;
        const full = path.join(current, name);
        const toResult = (value: string) =>
          root && full.replace(/\\/g, '/').startsWith(root + '/')
            ? full.replace(/\\/g, '/').slice(root.length + 1)
            : value.replace(/\\/g, '/');
        if (type === vscode.FileType.File) {
          results.push(toResult(rel));
        } else if (type === vscode.FileType.Directory) {
          if (deep) {
            await walk(full, rel);
          } else {
            results.push(`${toResult(rel)}/`);
          }
        }
      }
    };

    await walk(resolved, '');
    return results;
  }

  async readTextFileAbsolute(absPath: string): Promise<string> {
    return fs.readFile(absPath, 'utf8');
  }
}
