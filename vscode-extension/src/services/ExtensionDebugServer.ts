import * as vscode from 'vscode';
import * as http from 'node:http';
import type { AgentSession } from '../orchestration/AgentSession';
import type { AgentHostProcess } from './AgentHostProcess';

const HELP_TEXT = `WAB Extension Debug CLI (HTTP)

Base URL: http://127.0.0.1:9782 (override with webAgentBridge.debugPort)

Commands:
  GET  /debug/help
  GET  /debug/status
  POST /debug/click          {"action":"agent-mode|open-folder|open-file|save|save-as|send-current-file|send-selection"}
  POST /debug/select-agent   {"agentId":"example"}
  POST /debug/open-folder    {"path":"C:/work/project"} (omit path to open dialog)
  POST /debug/send-prompt    {"text":"hello", "agentId":"example"}
  GET  /debug/agent-dom?agentId=example
  GET  /debug/conversation?agentId=example
  GET  /debug/bridge-response?agentId=example
  GET  /debug/composer-ready?agentId=example
  GET  /debug/last-file-op
  POST /debug/reset-sync     {"agentId":"example"}

Send X-Agent-Host-Token with the value configured by webAgentBridge.hostToken.
`;

type DebugServerOptions = {
  session: AgentSession;
  host: AgentHostProcess;
};

export function startExtensionDebugServer(
  context: vscode.ExtensionContext,
  { session, host }: DebugServerOptions
): vscode.Disposable {
  const config = vscode.workspace.getConfiguration('webAgentBridge');
  const port = Number(process.env.WAB_DEBUG_PORT) || config.get<number>('debugPort', 9782);
  const token = host.getToken();

  const server = http.createServer((request, response) => {
    void handleRequest(request, response, session, host, token);
  });

  server.on('error', (err) => {
    console.error(`[wab-debug] failed to listen on 127.0.0.1:${port}`, err);
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`[wab-debug] CLI server listening on http://127.0.0.1:${port}`);
  });

  const disposable = new vscode.Disposable(() => server.close());
  context.subscriptions.push(disposable);
  return disposable;
}

async function handleRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  session: AgentSession,
  host: AgentHostProcess,
  token: string
): Promise<void> {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  const path = url.pathname;

  if (request.method === 'GET' && path === '/debug/help') {
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(HELP_TEXT);
    return;
  }

  if (request.headers['x-agent-host-token'] !== token) {
    writeJson(response, 401, { ok: false, error: 'unauthorized' });
    return;
  }

  try {
    const body = await readJsonBody(request);
    if (request.method === 'GET' && path === '/debug/status') {
      const hostStatus = host.isStarted()
        ? await host.request('GET', '/debug/status')
        : { ok: false, error: 'Agent Host is not started' };
      writeJson(response, 200, {
        ...(hostStatus as Record<string, unknown>),
        session: session.getSnapshot(),
      });
      return;
    }

    if (request.method === 'GET' && path === '/debug/last-file-op') {
      writeJson(response, 200, { ok: true, lastFileOp: session.getLastFileOp() });
      return;
    }

    if (request.method === 'GET' && path === '/debug/agent-dom') {
      writeJson(response, 200, await hostDebug(host, 'agent-dom', url.searchParams));
      return;
    }
    if (request.method === 'GET' && path === '/debug/conversation') {
      writeJson(response, 200, await hostDebug(host, 'conversation', url.searchParams));
      return;
    }
    if (request.method === 'GET' && path === '/debug/bridge-response') {
      writeJson(response, 200, await hostDebug(host, 'bridge-response', url.searchParams));
      return;
    }
    if (request.method === 'GET' && path === '/debug/composer-ready') {
      writeJson(response, 200, await hostDebug(host, 'composer-ready', url.searchParams));
      return;
    }
    if (request.method === 'POST' && path === '/debug/reset-sync') {
      requireAgentId(body.agentId);
      writeJson(response, 200, await host.request('POST', '/debug/reset-sync', body));
      return;
    }
    if (request.method === 'POST' && path === '/debug/select-agent') {
      const agentId = requireAgentId(body.agentId);
      session.setActiveAgent(agentId);
      writeJson(response, 200, { ok: true, agentId });
      return;
    }
    if (request.method === 'POST' && path === '/debug/send-prompt') {
      const text = typeof body.text === 'string' ? body.text : '';
      if (!text) throw new Error('text is required');
      const agentId = typeof body.agentId === 'string' ? body.agentId : undefined;
      await session.sendChat(text, agentId);
      writeJson(response, 200, { ok: true, agentId: agentId || session.getSnapshot().activeAgentId });
      return;
    }
    if (request.method === 'POST' && path === '/debug/open-folder') {
      const folderPath = typeof body.path === 'string' ? body.path : undefined;
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ ok: true, path: body.path || null }), () => {
        void openFolder(folderPath).catch((err) => {
          console.error('[wab-debug] open-folder failed', err);
        });
      });
      return;
    }
    if (request.method === 'POST' && path === '/debug/click') {
      const action = typeof body.action === 'string' ? body.action : '';
      await clickAction(action, session);
      writeJson(response, 200, { ok: true, action });
      return;
    }

    writeJson(response, 404, { ok: false, error: 'unknown debug endpoint' });
  } catch (err) {
    writeJson(response, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

async function hostDebug(
  host: AgentHostProcess,
  endpoint: string,
  params: URLSearchParams
): Promise<unknown> {
  const agentId = params.get('agentId') || params.get('agent_id') || 'example';
  return host.request('GET', `/debug/${endpoint}?agentId=${encodeURIComponent(agentId)}`);
}

async function clickAction(action: string, session: AgentSession): Promise<void> {
  const handlers: Record<string, () => unknown> = {
    'agent-mode': () => session.sendAgentMode(),
    'open-folder': () => openFolder(),
    'open-file': () => openFile(),
    save: () => vscode.commands.executeCommand('workbench.action.files.save'),
    'save-as': () => vscode.commands.executeCommand('workbench.action.files.saveAs'),
    'send-current-file': () => session.sendCurrentFile(),
    'send-selection': () => session.sendSelection(),
  };
  const handler = handlers[action];
  if (!handler) throw new Error(`unknown click action: ${action}`);
  await handler();
}

async function openFolder(folderPath?: string): Promise<void> {
  if (!folderPath) {
    await vscode.commands.executeCommand('workbench.action.files.openFolder');
    return;
  }
  await vscode.commands.executeCommand(
    'vscode.openFolder',
    vscode.Uri.file(folderPath),
    { forceNewWindow: false }
  );
}

async function openFile(): Promise<void> {
  const files = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Open' });
  if (!files?.[0]) return;
  const document = await vscode.workspace.openTextDocument(files[0]);
  await vscode.window.showTextDocument(document, { preview: false });
}

function requireAgentId(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('agentId is required');
  return value;
}

async function readJsonBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (Buffer.concat(chunks).length > 1024 * 1024) throw new Error('request body too large');
  }
  if (chunks.length === 0) return {};
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('request body must be a JSON object');
  }
  return value as Record<string, unknown>;
}

function writeJson(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}