import type { AgentToolDefinition } from './types.js';

export const runPowershellTool: AgentToolDefinition = {
  name: 'run_powershell',
  description: '在当前工作区目录使用 PowerShell 执行命令',
  args: [
    {
      name: 'command',
      description: '要执行的 PowerShell 命令',
    },
  ],
  action: 'run_powershell',
  parseArgs(args) {
    const command = args.command?.trim();
    if (!command) return null;
    return { action: 'run_powershell', path: '', command };
  },
  toArgs(operation) {
    return { command: operation.command ?? '' };
  },
};
