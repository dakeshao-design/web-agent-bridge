export const PLAN_TEMPLATE_HOME_PATH = '.web-agent-bridge/plans/plan-prompt-template.md';

export function createPlanTimestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours()
  )}${pad(date.getMinutes())}`;
}

export function buildPlanCreationPrompt(input: {
  description: string;
  template: string;
  workspaceRoot: string;
  timestamp: string;
}): string {
  const template = input.template;
  if (!template.includes('{{USER_DESCRIPTION}}')) {
    throw new Error('计划模板缺少 {{USER_DESCRIPTION}} 占位符');
  }
  if (
    !template.includes('{{WORKSPACE_ROOT}}') ||
    !template.includes('{{PLAN_ID}}') ||
    !template.includes('{{TIMESTAMP}}')
  ) {
    throw new Error('计划模板缺少工作区、ID 或时间戳占位符');
  }

  const workspaceRoot = input.workspaceRoot.trim().replace(/[\\/]+$/, '');
  const values = {
    USER_DESCRIPTION: input.description.trim(),
    WORKSPACE_ROOT: workspaceRoot,
    TIMESTAMP: input.timestamp,
  };
  return template.replace(
    /\{\{(USER_DESCRIPTION|WORKSPACE_ROOT|TIMESTAMP)\}\}/g,
    (_placeholder, name: keyof typeof values) => values[name]
  );
}
