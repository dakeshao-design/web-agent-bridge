import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

const CONFIG_DIR_NAME = 'agent-editor';

export class ConfigService {
  private readonly userRoot: string;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.userRoot = path.join(os.homedir(), 'AppData', 'Roaming', CONFIG_DIR_NAME);
  }

  getUserRoot(): string {
    return this.userRoot;
  }

  getAppConfigPath(): string {
    return path.join(this.userRoot, 'config', 'app.config.json');
  }

  getScriptsDir(): string {
    return path.join(this.userRoot, 'scripts');
  }

  private async resolveTemplateSource(): Promise<string> {
    const bundled = path.join(this.context.extensionPath, 'templates');
    try {
      await fs.access(path.join(bundled, 'config', 'app.config.json'));
      return bundled;
    } catch {
      // Extension Development Host：仓库根
      return path.resolve(this.context.extensionPath, '..');
    }
  }

  async ensureUserConfig(): Promise<void> {
    const source = await this.resolveTemplateSource();
    await fs.mkdir(path.join(this.userRoot, 'config'), { recursive: true });
    await fs.mkdir(path.join(this.userRoot, 'scripts'), { recursive: true });

    const appPath = this.getAppConfigPath();
    try {
      await fs.access(appPath);
    } catch {
      await fs.copyFile(path.join(source, 'config', 'app.config.json'), appPath);
    }

    const scriptsSource = path.join(source, 'scripts');
    let names: string[] = [];
    try {
      names = await fs.readdir(scriptsSource);
    } catch {
      return;
    }
    for (const name of names) {
      if (!name.endsWith('.js')) continue;
      const dest = path.join(this.userRoot, 'scripts', name);
      try {
        await fs.access(dest);
      } catch {
        await fs.copyFile(path.join(scriptsSource, name), dest);
      }
    }
  }

  async openAgentsConfig(): Promise<void> {
    await this.ensureUserConfig();
    const uri = vscode.Uri.file(this.getScriptsDir());
    await vscode.commands.executeCommand('revealFileInOS', uri);
  }

  async openAppConfig(): Promise<void> {
    await this.ensureUserConfig();
    const doc = await vscode.workspace.openTextDocument(this.getAppConfigPath());
    await vscode.window.showTextDocument(doc);
  }

  async openConfigFolder(): Promise<void> {
    await this.ensureUserConfig();
    const uri = vscode.Uri.file(this.userRoot);
    await vscode.commands.executeCommand('revealFileInOS', uri);
  }

  async resetConfigWithConfirm(): Promise<void> {
    const pick = await vscode.window.showWarningMessage(
      '将用默认模板覆盖用户 config/scripts，是否继续？',
      { modal: true },
      '覆盖'
    );
    if (pick !== '覆盖') return;
    await fs.rm(this.userRoot, { recursive: true, force: true });
    await this.ensureUserConfig();
    const source = await this.resolveTemplateSource();
    await fs.cp(path.join(source, 'config'), path.join(this.userRoot, 'config'), {
      recursive: true,
    });
    await fs.cp(path.join(source, 'scripts'), path.join(this.userRoot, 'scripts'), {
      recursive: true,
    });
    vscode.window.showInformationMessage('配置已重置');
  }

  async readBridgeScript(relativePath: string): Promise<string> {
    const normalized = relativePath.replace(/^\.?[/\\]/, '');
    const full = path.join(this.userRoot, normalized);
    return fs.readFile(full, 'utf8');
  }

  async listBridgeScripts(): Promise<{ relativePath: string; content: string }[]> {
    await this.ensureUserConfig();
    const dir = this.getScriptsDir();
    let names: string[] = [];
    try {
      names = await fs.readdir(dir);
    } catch {
      return [];
    }
    names = names.filter((n) => n.endsWith('.js')).sort();
    const out: { relativePath: string; content: string }[] = [];
    for (const name of names) {
      const content = await fs.readFile(path.join(dir, name), 'utf8');
      out.push({ relativePath: `scripts/${name}`, content });
    }
    return out;
  }

  async readAppConfigRaw(): Promise<string> {
    await this.ensureUserConfig();
    return fs.readFile(this.getAppConfigPath(), 'utf8');
  }

  async writeAppConfigRaw(content: string): Promise<void> {
    await this.ensureUserConfig();
    await fs.writeFile(this.getAppConfigPath(), content, 'utf8');
  }

  watchConfig(onChange: () => void): vscode.Disposable {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(path.join(this.userRoot, 'config')), '*.json')
    );
    const scriptWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(this.getScriptsDir()), '*.js')
    );
    const fire = () => onChange();
    watcher.onDidChange(fire);
    watcher.onDidCreate(fire);
    scriptWatcher.onDidChange(fire);
    scriptWatcher.onDidCreate(fire);
    return vscode.Disposable.from(watcher, scriptWatcher);
  }
}
