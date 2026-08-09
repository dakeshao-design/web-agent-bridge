import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export type DebugCommandPayload = {
  type: string;
  action?: string;
  path?: string | null;
  agentId?: string;
  text?: string;
};

export type DebugHandlers = {
  click: Record<string, () => void | Promise<void>>;
  openFolder: (path?: string) => void | Promise<void>;
  selectAgent: (agentId: string) => void;
  sendPrompt: (text: string, agentId?: string) => void | Promise<void>;
};

export function setupDebugController(handlers: DebugHandlers): Promise<UnlistenFn> {
  return listen<DebugCommandPayload>('debug-command', async (event) => {
    const payload = event.payload;
    try {
      switch (payload.type) {
        case 'click': {
          const action = payload.action || '';
          const handler = handlers.click[action];
          if (!handler) {
            console.warn(`[debug] unknown click action: ${action}`);
            return;
          }
          await handler();
          break;
        }
        case 'open-folder':
          await handlers.openFolder(payload.path || undefined);
          break;
        case 'select-agent':
          if (payload.agentId) {
            handlers.selectAgent(payload.agentId);
          }
          break;
        case 'send-prompt':
          if (payload.text) {
            await handlers.sendPrompt(payload.text, payload.agentId);
          }
          break;
        default:
          console.warn(`[debug] unknown command type: ${payload.type}`);
      }
    } catch (err) {
      console.error('[debug] command failed', err);
    }
  });
}
