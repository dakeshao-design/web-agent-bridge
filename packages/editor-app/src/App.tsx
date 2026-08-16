import { useCallback, useEffect, useRef, useState, startTransition } from 'react';
import {
  ConfigLoader,
  FileOperationParser,
  CallToolParser,
  buildAgentModePrompt,
  buildToolResultFromOperation,
  buildPowershellFinalResult,
  buildPowershellProgressMessage,
  buildPowershellTerminatedResult,
  fileOperationsFingerprint,
  isToolCallAlreadyReported,
  hasIncompleteCallTool,
  isIncompleteFromLastConversation,
  buildIncompleteCallToolHint,
  IncompleteCallToolConfirm,
  findUnknownCallToolNames,
  buildUnknownToolResult,
  resolveEffectivePermission,
  resolveToolNameForOperation,
  buildDeniedToolResult,
  buildPermissionAskMessage,
  mergeToolPermissions,
  buildSelectionMessage,
  parseFileLineLimitsFromBridgeScript,
  POWERSHELL_PROGRESS_INTERVAL_MS,
  parsePowershellWaitDecision,
  type AgentConfig,
  type AgentStatus,
  type AppConfig,
  type FileOperation,
  type ToolApplyResult,
  type ToolPermissionMode,
  type ToolPermissionsConfig,
} from '@my-agent-editor/shared';
import { ask, message } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { Editor, type EditorSelectionInfo } from './components/Editor';
import { AgentPanel } from './components/AgentPanel';
import { FileTree } from './components/FileTree';
import { ResizeHandle } from './components/ResizeHandle';
import { ChatLogPanel } from './components/ChatLogPanel';
import { SettingsPanel } from './components/SettingsPanel';
import type { FileOpLogEntry } from './components/FileOpLog';
import { TauriFileService } from './services/TauriFileService';
import { WebViewAgentBridge } from './services/WebViewAgentBridge';
import { setupDebugController } from './services/DebugController';
import {
  ConversationLogService,
  type ChatLogEntry,
} from './services/ConversationLogService';
import { applyFileOperation as executeFileTool } from './tools';
import {
  killAllPowershellSessions,
  startPowershellSession,
} from './tools/handlers/runPowershellHandler';
import { toRelativePath } from './services/file/pathUtils';

const fileService = new TauriFileService();
const agentBridge = new WebViewAgentBridge();
const conversationLogService = new ConversationLogService(fileService);

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeWorkspaceRoot(root: string): string {
  return root.trim().replace(/\\/g, '/').replace(/\/$/, '');
}

function buildShellLogContent(command: string, exitCode: number, output: string): string {
  const consoleOut = output.trim() ? output : '(无输出)';
  return `PS> ${command}\n${consoleOut}\nexit code: ${exitCode}`;
}

const RESIZE_HANDLE_TOTAL_WIDTH = 10;
const EDITOR_MIN_WIDTH = 100;
const FILE_TREE_MIN_WIDTH = 120;
const AGENT_PANEL_MIN_WIDTH = 200;

export default function App() {
  const [content, setContent] = useState('');
  const [filePath, setFilePath] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [agentStatuses, setAgentStatuses] = useState<Record<string, AgentStatus>>({});
  const [logEntries, setLogEntries] = useState<FileOpLogEntry[]>([]);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [selection, setSelection] = useState<EditorSelectionInfo>({
    text: '',
    startLine: 1,
    endLine: 1,
  });
  const [theme, setTheme] = useState('one-dark');
  const [tabSize, setTabSize] = useState(2);
  const [workspaceRoot, setWorkspaceRoot] = useState('');
  const [treeRefreshKey, setTreeRefreshKey] = useState(0);
  const [agentModeEnabled, setAgentModeEnabled] = useState(false);
  const [fileTreeWidth, setFileTreeWidth] = useState(240);
  const [agentPanelWidth, setAgentPanelWidth] = useState(480);
  const [mainContentWidth, setMainContentWidth] = useState(0);
  const [chatLogEntries, setChatLogEntries] = useState<ChatLogEntry[]>([]);
  const [chatLogFilePath, setChatLogFilePath] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<ToolPermissionsConfig>(mergeToolPermissions());
  const [settingsSaving, setSettingsSaving] = useState(false);

  const configLoaderRef = useRef<ConfigLoader | null>(null);
  const userWorkspaceRef = useRef('');
  const parserRef = useRef<FileOperationParser | null>(null);
  const callToolParserRef = useRef<CallToolParser | null>(null);
  const webviewsCreatedRef = useRef<Set<string>>(new Set());
  const boundsRef = useRef({ x: 0, y: 0, width: 400, height: 600 });
  const mainContentRef = useRef<HTMLElement | null>(null);
  const inflightToolOpsRef = useRef<Set<string>>(new Set());
  const loggedToolCaptureRef = useRef<Set<string>>(new Set());
  const loggedChatKeysRef = useRef<Set<string>>(new Set());
  const loggedAgentTextsRef = useRef<Map<string, string>>(new Map());
  const activeAgentIdRef = useRef<string | null>(null);
  const agentsRef = useRef<AgentConfig[]>([]);
  const toolPermissionsRef = useRef<ToolPermissionsConfig>(mergeToolPermissions());
  const adminModeRef = useRef(false);
  const settingsOpenRef = useRef(false);
  const incompleteHintRef = useRef<Set<string>>(new Set());
  const unknownToolHintRef = useRef<Set<string>>(new Set());
  const incompleteConfirmRef = useRef(new IncompleteCallToolConfirm());
  const pendingPowershellDecisionRef = useRef<
    Map<string, { resolve: (text: string | null) => void }>
  >(new Map());
  const agentStatusesRef = useRef<Record<string, AgentStatus>>({});
  const waitingWatchRef = useRef(
    new Map<
      string,
      {
        sawLoading: boolean;
        consecutiveNotLoading: number;
        lastText: string;
        textStableSince: number;
      }
    >()
  );
  const handleAgentResponseRef = useRef<
    (agentId: string, text: string, key?: number) => Promise<void>
  >(async () => undefined);

  useEffect(() => {
    activeAgentIdRef.current = activeAgentId;
  }, [activeAgentId]);

  useEffect(() => {
    void invoke<boolean>('is_admin_mode')
      .then((v) => {
        adminModeRef.current = !!v;
      })
      .catch(() => {
        adminModeRef.current = false;
      });
  }, []);

  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);

  useEffect(() => {
    agentStatusesRef.current = agentStatuses;
  }, [agentStatuses]);

  const lastAgentText = useCallback((agentId: string) => {
    return (
      [...conversationLogService.getEntries()]
        .reverse()
        .find((entry) => entry.agentId === agentId && entry.role === 'agent')?.content ?? ''
    );
  }, []);

  const setAgentStatus = useCallback(
    (agentId: string, status: AgentStatus) => {
      setAgentStatuses((prev) => {
        if (prev[agentId] === status) return prev;
        return { ...prev, [agentId]: status };
      });
      if (status === 'waiting') {
        waitingWatchRef.current.set(agentId, {
          sawLoading: false,
          consecutiveNotLoading: 0,
          lastText: lastAgentText(agentId),
          textStableSince: Date.now(),
        });
      } else {
        waitingWatchRef.current.delete(agentId);
      }
    },
    [lastAgentText]
  );

  const publishLastFileOp = useCallback(
    (op: FileOperation, status: string, message?: string) => {
      const snapshot = {
        action: op.action,
        path: op.path,
        status,
        message: message ?? '',
        contentLength: op.content?.length ?? 0,
        at: new Date().toISOString(),
      };
      (window as unknown as { __agentEditorLastFileOp?: typeof snapshot }).__agentEditorLastFileOp =
        snapshot;
    },
    []
  );

  const resolveFilePath = useCallback((path: string) => {
    if (/^([A-Za-z]:[\\/]|\/)/.test(path)) {
      return path.replace(/\\/g, '/');
    }
    const root = workspaceRoot.replace(/\\/g, '/').replace(/\/$/, '');
    if (!root) return path;
    return `${root}/${path.replace(/\\/g, '/')}`;
  }, [workspaceRoot]);

  const handleContentChange = useCallback((newContent: string) => {
    setContent(newContent);
    setIsDirty(true);
  }, []);

  const getAgentName = useCallback(
    (agentId: string) => agents.find((a) => a.id === agentId)?.name ?? agentId,
    [agents]
  );

  const refreshChatLog = useCallback(() => {
    startTransition(() => {
      setChatLogEntries([...conversationLogService.getEntries()]);
      setChatLogFilePath(conversationLogService.getLogFilePath());
    });
  }, []);

  const logUserMessage = useCallback(
    async (agentId: string, content: string, source?: string) => {
      const entries = conversationLogService.getEntries();
      const last = entries[entries.length - 1];
      if (
        last &&
        last.role === 'user' &&
        last.agentId === agentId &&
        last.source === source &&
        last.content.trim() === content.trim()
      ) {
        return;
      }
      await conversationLogService.addEntry('user', agentId, getAgentName(agentId), content, source);
      refreshChatLog();
    },
    [getAgentName, refreshChatLog]
  );

  const logAgentMessage = useCallback(
    async (agentId: string, content: string) => {
      const entries = conversationLogService.getEntries();
      const last = entries[entries.length - 1];
      if (
        last &&
        last.role === 'agent' &&
        last.agentId === agentId &&
        last.content.trim() === content.trim()
      ) {
        return;
      }
      if (content.includes('BEGIN_TOOL')) {
        const captureKey = `copy:${agentId}:${content}`;
        if (!loggedToolCaptureRef.current.has(captureKey)) {
          loggedToolCaptureRef.current.add(captureKey);
          await conversationLogService.addEntry(
            'bridge-copy',
            agentId,
            getAgentName(agentId),
            `status: captured\nlength: ${content.length}\ntext:\n${content}`
          );
        }
      }
      await conversationLogService.addEntry('agent', agentId, getAgentName(agentId), content);
      refreshChatLog();
    },
    [getAgentName, refreshChatLog]
  );

  const sendToolResultToAgent = useCallback(
    async (agentId: string, message: string) => {
      await agentBridge.sendMessage(agentId, message);
    },
    []
  );

  const logAndSendToAgent = useCallback(
    async (message: string, source?: string, agentIdOverride?: string) => {
      if (!workspaceRoot) return;
      const targetId = agentIdOverride || activeAgentIdRef.current;
      if (!targetId) return;
      await logUserMessage(targetId, message, source);
      setAgentStatus(targetId, 'sending');
      await sendToolResultToAgent(targetId, message);
      setAgentStatus(targetId, 'waiting');
    },
    [workspaceRoot, logUserMessage, sendToolResultToAgent, setAgentStatus]
  );

  const logAndFillAgent = useCallback(
    async (message: string, source?: string, agentIdOverride?: string) => {
      if (!workspaceRoot) return;
      const targetId = agentIdOverride || activeAgentIdRef.current;
      if (!targetId) return;
      await agentBridge.fillMessage(targetId, message);
    },
    [workspaceRoot]
  );

  const addLogEntry = useCallback(
    (operation: FileOperation, status: FileOpLogEntry['status'], message?: string) => {
      setLogEntries((prev) => [
        {
          id: generateId(),
          timestamp: new Date(),
          operation,
          status,
          message,
        },
        ...prev.slice(0, 49),
      ]);
    },
    []
  );

  const applyFileOperation = useCallback(
    async (op: FileOperation, readFileLineLimit?: number) => {
      const result = await executeFileTool(op, {
        fileService,
        workspaceRoot,
        resolvePath: resolveFilePath,
        filePath,
        setContent,
        setFilePath,
        setIsDirty,
        addLogEntry,
        publishLastFileOp,
        readFileLineLimit,
      });
      if (
        result.ok &&
        (op.action === 'write' ||
          op.action === 'append' ||
          op.action === 'delete' ||
          op.action === 'delete_path' ||
          op.action === 'move' ||
          op.action === 'copy')
      ) {
        setTreeRefreshKey((key) => key + 1);
      }
      return result;
    },
    [addLogEntry, filePath, resolveFilePath, publishLastFileOp, workspaceRoot]
  );

  const handleChatMessage = useCallback(
    async (agentId: string, role: 'user' | 'agent', key: number, text: string) => {
      incompleteConfirmRef.current.onContentChange(agentId, text);

      if (role === 'agent') {
        const dedupeKey = `${agentId}:agent:${key}`;
        const prevText = loggedAgentTextsRef.current.get(dedupeKey);
        if (key >= 0 && loggedChatKeysRef.current.has(dedupeKey)) {
          if (!prevText || prevText === text) {
            return;
          }
          // 同 key 下 tool 内容变化时再处理
          const toolChanged = text.includes('BEGIN_TOOL') && text !== prevText;
          const grewMuch = text.length > prevText.length + 40;
          if (!toolChanged && !grewMuch) {
            return;
          }
          loggedChatKeysRef.current.delete(dedupeKey);
        }
        if (key >= 0) {
          loggedChatKeysRef.current.add(dedupeKey);
          loggedAgentTextsRef.current.set(dedupeKey, text);
        }
        await logAgentMessage(agentId, text);
        return;
      }

      const dedupeKey = `${agentId}:user:${key}`;
      if (key >= 0 && loggedChatKeysRef.current.has(dedupeKey)) {
        return;
      }

      const entries = conversationLogService.getEntries();
      const lastUser = [...entries]
        .reverse()
        .find((entry) => entry.role === 'user' && entry.agentId === agentId);
      if (lastUser && lastUser.content.trim() === text.trim()) {
        if (key >= 0) loggedChatKeysRef.current.add(dedupeKey);
        return;
      }

      if (key >= 0) loggedChatKeysRef.current.add(dedupeKey);
      await logUserMessage(agentId, text, 'WebView');
    },
    [logUserMessage, logAgentMessage]
  );

  const handleBridgeComm = useCallback(
    async (agentId: string, direction: 'request' | 'response' | 'copy', content: string) => {
      await conversationLogService.addBridgeEntry(
        direction,
        agentId,
        getAgentName(agentId),
        content
      );
      refreshChatLog();
    },
    [getAgentName, refreshChatLog]
  );

  const handleAgentResponse = useCallback(
    async (agentId: string, text: string, key?: number) => {
      const pending = pendingPowershellDecisionRef.current.get(agentId);
      if (pending) {
        pendingPowershellDecisionRef.current.delete(agentId);
        pending.resolve(text);
        return;
      }

      setLastSync(new Date());

      const parser = parserRef.current;
      const callToolParser = callToolParserRef.current;
      if (!parser) {
        setAgentStatus(agentId, 'idle');
        return;
      }

      const operations = [
        ...parser.parse(text),
        ...(callToolParser?.parse(text) ?? []),
      ];

      if (operations.length === 0) {
        // 会话/桥接定稿都会进入；未知工具优先于缺 END_TOOL
        const unknownNames = findUnknownCallToolNames(text);
        if (unknownNames.length > 0) {
          const hintKey = `${agentId}:unknown:${unknownNames.join(',')}`;
          if (!unknownToolHintRef.current.has(hintKey)) {
            unknownToolHintRef.current.add(hintKey);
            const hint = buildUnknownToolResult(unknownNames, toolPermissionsRef.current);
            await logUserMessage(agentId, hint, '工具结果');
            await sendToolResultToAgent(agentId, hint);
            setAgentStatus(agentId, 'waiting');
          } else {
            setAgentStatus(agentId, 'idle');
          }
          return;
        }

        // 缺 END_TOOL 仅桥接定稿通道 key=-1，避免流式误报
        if (key === -1 && hasIncompleteCallTool(text)) {
          const lastAgent = [...conversationLogService.getEntries()]
            .reverse()
            .find((entry) => entry.agentId === agentId && entry.role === 'agent')?.content;
          const isLast = isIncompleteFromLastConversation(text, lastAgent);
          const loading = await agentBridge.isLoading(agentId);
          incompleteConfirmRef.current.discover(agentId, text, {
            isLastConversation: isLast,
            isLoading: loading,
            alreadyReported: (hk) => incompleteHintRef.current.has(hk),
            markReported: (hk) => {
              incompleteHintRef.current.add(hk);
            },
            revalidate: async () => {
              if (await agentBridge.isLoading(agentId)) return false;
              const latest = [...conversationLogService.getEntries()]
                .reverse()
                .find((entry) => entry.agentId === agentId && entry.role === 'agent')?.content;
              return isIncompleteFromLastConversation(text, latest);
            },
            onConfirm: async () => {
              const limit = agentsRef.current.find((a) => a.id === agentId)?.writeFileLineLimit;
              const hint = buildIncompleteCallToolHint(limit);
              await logUserMessage(agentId, hint, '工具结果');
              await sendToolResultToAgent(agentId, hint);
              setAgentStatus(agentId, 'waiting');
            },
          });
        } else {
          incompleteConfirmRef.current.onContentChange(agentId, text);
        }
        setAgentStatus(agentId, 'idle');
        return;
      }

      incompleteConfirmRef.current.onContentChange(agentId, text);

      const opsFp = fileOperationsFingerprint(operations);
      const inflightKey = `${agentId}:${opsFp}`;
      if (inflightToolOpsRef.current.has(inflightKey)) {
        return;
      }

      const history = conversationLogService
        .getEntries()
        .filter(
          (entry) =>
            entry.agentId === agentId &&
            (entry.role === 'agent' || entry.role === 'user' || entry.role === 'shell')
        )
        .map((entry) => entry.content)
        .join('\n');
      const lastEntry = conversationLogService
        .getEntries()
        .filter((entry) => entry.agentId === agentId)
        .map((entry) => entry.content)
        .at(-1);
      const transcript =
        lastEntry === text || history.includes(text) ? history : `${history}\n${text}`;
      if (isToolCallAlreadyReported(transcript, operations)) {
        setAgentStatus(agentId, 'idle');
        return;
      }

      setAgentStatus(agentId, 'waiting');
      inflightToolOpsRef.current.add(inflightKey);
      let awaitAgentReply = false;

      try {
      for (const op of operations) {
        const toolName = resolveToolNameForOperation(op);
        const effective = resolveEffectivePermission(
          toolName,
          op,
          workspaceRoot,
          toolPermissionsRef.current,
          resolveFilePath,
          { skipOutsideWorkspaceDowngrade: adminModeRef.current }
        );
        if (effective === 'deny') {
          const denied = buildDeniedToolResult(toolName);
          addLogEntry(op, 'error', '权限禁止');
          publishLastFileOp(op, 'error', '权限禁止');
          await logUserMessage(agentId, denied, '工具结果');
          await sendToolResultToAgent(agentId, denied);
          awaitAgentReply = true;
          continue;
        }
        if (effective === 'ask') {
          const ok = await ask(buildPermissionAskMessage(toolName, op), {
            title: '工具权限确认',
            kind: 'warning',
          });
          if (!ok) {
            addLogEntry(op, 'error', '用户取消');
            publishLastFileOp(op, 'error', '用户取消');
            continue;
          }
        }

        if (op.action === 'run_powershell') {
          const command = op.command?.trim() ?? '';
          const cwd = workspaceRoot.trim();
          if (!command || !cwd) {
            const result = {
              ok: false,
              message: !command ? 'command 为空' : '工作区未打开',
            } satisfies ToolApplyResult;
            addLogEntry(op, 'error', result.message);
            publishLastFileOp(op, 'error', result.message);
            await logUserMessage(
              agentId,
              buildToolResultFromOperation(op, result),
              '工具结果'
            );
            await sendToolResultToAgent(
              agentId,
              buildToolResultFromOperation(op, result)
            );
            awaitAgentReply = true;
            continue;
          }

          const session = await startPowershellSession(command, cwd);
          const t0 = Date.now();
          let reported = 0;
          let sentFinal = false;

          const logShell = async (
            result: ToolApplyResult,
            exitCode: number
          ) => {
            const output = result.content ?? '';
            await conversationLogService.addEntry(
              'shell',
              agentId,
              getAgentName(agentId),
              buildShellLogContent(command, exitCode, output),
              'run_powershell',
              { command, exitCode, output, ok: result.ok }
            );
            refreshChatLog();
          };

          const sendFinal = async (result: ToolApplyResult, exitCode: number) => {
            if (sentFinal) return;
            sentFinal = true;
            addLogEntry(op, result.ok ? 'applied' : 'error', result.message);
            publishLastFileOp(op, result.ok ? 'applied' : 'error', result.message);
            await logShell(result, exitCode);
            await sendToolResultToAgent(
              agentId,
              buildToolResultFromOperation(op, result)
            );
            awaitAgentReply = true;
          };

          let skippedReply: string | undefined;
          while (true) {
            const outcome = await session.wait(POWERSHELL_PROGRESS_INTERVAL_MS);
            if (outcome === 'exited') {
              const exitCode = session.getExitCode() ?? 1;
              await sendFinal(
                buildPowershellFinalResult({
                  content: session.getOutput(),
                  exitCode,
                }),
                exitCode
              );
              break;
            }
            if (outcome === 'killed') {
              await sendFinal(
                buildPowershellTerminatedResult({
                  content: session.getOutput(),
                  reason: 'user',
                }),
                -1
              );
              break;
            }

            const all = session.getOutput();
            const neu = all.slice(reported);
            reported = all.length;
            const elapsedSec = Math.round((Date.now() - t0) / 1000);
            await sendToolResultToAgent(
              agentId,
              buildPowershellProgressMessage({
                command,
                elapsedSec,
                newOutput: neu,
              })
            );
            awaitAgentReply = true;

            const reply = await new Promise<string | null>((resolve) => {
              const prev = pendingPowershellDecisionRef.current.get(agentId);
              if (prev) prev.resolve(null);
              pendingPowershellDecisionRef.current.set(agentId, { resolve });
            });
            pendingPowershellDecisionRef.current.delete(agentId);

            if (reply === null) {
              if (!session.isExited()) session.kill();
              await sendFinal(
                buildPowershellTerminatedResult({
                  content: session.getOutput(),
                  reason: 'user',
                }),
                -1
              );
              break;
            }

            const decision = parsePowershellWaitDecision(reply);
            if (decision === 'continue') continue;
            if (decision === 'terminate') {
              session.kill();
              await session.wait(Number.POSITIVE_INFINITY);
              await sendFinal(
                buildPowershellTerminatedResult({
                  content: session.getOutput(),
                  reason: 'agent',
                }),
                -1
              );
              break;
            }
            skippedReply = reply;
            session.watchInBackground?.();
            break;
          }

          if (skippedReply) {
            await handleAgentResponseRef.current(agentId, skippedReply);
          }
          continue;
        }

        const readFileLineLimit = agentsRef.current.find((a) => a.id === agentId)?.readFileLineLimit;
        const result = await applyFileOperation(op, readFileLineLimit);
        const toolResultMessage = buildToolResultFromOperation(op, result);
        await logUserMessage(agentId, toolResultMessage, '工具结果');
        await sendToolResultToAgent(agentId, toolResultMessage);
        awaitAgentReply = true;
      }
      } finally {
        inflightToolOpsRef.current.delete(inflightKey);
      }

      setAgentStatus(agentId, awaitAgentReply ? 'waiting' : 'idle');
    },
    [
      addLogEntry,
      applyFileOperation,
      getAgentName,
      logUserMessage,
      publishLastFileOp,
      refreshChatLog,
      resolveFilePath,
      sendToolResultToAgent,
      setAgentStatus,
      workspaceRoot,
    ]
  );

  useEffect(() => {
    handleAgentResponseRef.current = handleAgentResponse;
  }, [handleAgentResponse]);

  // waiting 图标：isLoading 结束或对话安定 3s 且无工具时清为 idle
  useEffect(() => {
    const timer = window.setInterval(() => {
      void (async () => {
        const statuses = agentStatusesRef.current;
        for (const [agentId, status] of Object.entries(statuses)) {
          if (status !== 'waiting') continue;

          const loading = await agentBridge.isLoading(agentId);
          let watch = waitingWatchRef.current.get(agentId);
          if (!watch) {
            watch = {
              sawLoading: false,
              consecutiveNotLoading: 0,
              lastText: lastAgentText(agentId),
              textStableSince: Date.now(),
            };
            waitingWatchRef.current.set(agentId, watch);
          }

          const text = lastAgentText(agentId);
          if (text !== watch.lastText) {
            watch.lastText = text;
            watch.textStableSince = Date.now();
          }

          if (loading) {
            watch.sawLoading = true;
            watch.consecutiveNotLoading = 0;
            watch.textStableSince = Date.now();
            continue;
          }

          if (watch.sawLoading) {
            watch.consecutiveNotLoading += 1;
            if (watch.consecutiveNotLoading >= 2) {
              setAgentStatus(agentId, 'idle');
              continue;
            }
          }

          const hasInflight = [...inflightToolOpsRef.current].some((k) =>
            k.startsWith(`${agentId}:`)
          );
          const hasPendingPs = pendingPowershellDecisionRef.current.has(agentId);
          if (
            !hasInflight &&
            !hasPendingPs &&
            Date.now() - watch.textStableSince >= 3000
          ) {
            setAgentStatus(agentId, 'idle');
          }
        }
      })();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [lastAgentText, setAgentStatus]);

  const handleKillTerminal = useCallback(async () => {
    for (const [agentId, pending] of pendingPowershellDecisionRef.current) {
      pending.resolve(null);
      pendingPowershellDecisionRef.current.delete(agentId);
    }
    const n = await killAllPowershellSessions();
    await message(
      n > 0 ? `已终止 ${n} 个 PowerShell 进程` : '无运行中的 PowerShell'
    );
  }, []);

  const initConfig = useCallback(async () => {
    const loader = new ConfigLoader({
      appConfigPath: 'config/app.config.json',
      fetchJson: (path) => fileService.readConfigFile(path),
      listBridgeScripts: () => fileService.listBridgeScripts(),
      watch: (paths, onChange) => {
        const interval = setInterval(async () => {
          try {
            onChange();
          } catch {
            // 配置加载失败时忽略
          }
        }, 3000);
        return () => clearInterval(interval);
      },
    });

    await loader.load();
    configLoaderRef.current = loader;

    const appConfig = loader.getAppConfig();
    const perms = mergeToolPermissions(appConfig.toolPermissions);
    toolPermissionsRef.current = perms;
    setSettingsDraft(perms);
    setTheme(appConfig.editor.theme);
    setTabSize(appConfig.editor.tabSize);
    const configWorkspace = normalizeWorkspaceRoot(appConfig.fileBridge.workspaceRoot);
    if (configWorkspace) {
      userWorkspaceRef.current = '';
      fileService.setWorkspaceRoot(configWorkspace);
      setWorkspaceRoot(configWorkspace);
    }
    parserRef.current = new FileOperationParser(appConfig.fileBridge.commandFormat);
    callToolParserRef.current = new CallToolParser();

    const attachFileLineLimits = async (list: AgentConfig[]): Promise<AgentConfig[]> => {
      return Promise.all(
        list.map(async (agent) => {
          try {
            const scriptPath = agent.injectScript.replace(/^scripts\//, 'scripts/');
            const src = await fileService.readBridgeScript(scriptPath);
            const limits = parseFileLineLimitsFromBridgeScript(src);
            return {
              ...agent,
              ...(limits.read != null ? { readFileLineLimit: limits.read } : {}),
              ...(limits.write != null ? { writeFileLineLimit: limits.write } : {}),
            };
          } catch {
            return agent;
          }
        })
      );
    };

    const enabledAgents = await attachFileLineLimits(loader.getEnabledAgents());
    setAgents(enabledAgents);
    setActiveAgentId((prev) => prev ?? (enabledAgents[0]?.id ?? null));
    if (enabledAgents.length === 0) {
      console.warn(
        '[App] 没有可用的 Agent，请检查 scripts/*-bridge.js 头注释。'
      );
    }

    loader.onChange(({ agents: agentsConfig, app }) => {
      void (async () => {
        const next = await attachFileLineLimits(
          agentsConfig.agents.filter((a) => a.enabled)
        );
        setAgents(next);
      })();
      toolPermissionsRef.current = mergeToolPermissions(app.toolPermissions);
      setSettingsDraft(mergeToolPermissions(app.toolPermissions));
      setTheme(app.editor.theme);
      setTabSize(app.editor.tabSize);
      const configWorkspace = normalizeWorkspaceRoot(app.fileBridge.workspaceRoot);
      if (configWorkspace) {
        userWorkspaceRef.current = '';
        fileService.setWorkspaceRoot(configWorkspace);
        setWorkspaceRoot(configWorkspace);
      }
      parserRef.current = new FileOperationParser(app.fileBridge.commandFormat);
      callToolParserRef.current = new CallToolParser();
    });

    loader.startWatch();
  }, []);

  const hideAllAgentWebviews = useCallback(async () => {
    for (const agent of agentsRef.current) {
      if (!webviewsCreatedRef.current.has(agent.id)) continue;
      try {
        await agentBridge.hideWebview(agent.id);
      } catch {
        // 未创建可忽略
      }
    }
  }, []);

  const syncAgentWebviewVisibility = useCallback(async () => {
    if (settingsOpenRef.current) {
      await hideAllAgentWebviews();
      return;
    }
    const activeId = activeAgentIdRef.current;
    if (!activeId) return;
    if (!webviewsCreatedRef.current.has(activeId)) return;
    const bounds = boundsRef.current;
    try {
      await agentBridge.showWebview(activeId, bounds);
    } catch (err) {
      console.warn(`showWebview failed: ${activeId}`, err);
      webviewsCreatedRef.current.delete(activeId);
    }
    for (const agent of agents) {
      if (agent.id === activeId) continue;
      if (!webviewsCreatedRef.current.has(agent.id)) continue;
      try {
        await agentBridge.hideWebview(agent.id);
      } catch {
        // 未创建的 Agent 可忽略
      }
    }
  }, [agents, hideAllAgentWebviews]);

  // 首次切到该 Agent 时按需创建 WebView
  const ensureAgentWebview = useCallback(
    async (agentId: string) => {
      if (!workspaceRoot) return;
      const agent = agents.find((a) => a.id === agentId);
      if (!agent) return;

      await agentBridge.whenReady();
      const bounds = boundsRef.current;

      if (webviewsCreatedRef.current.has(agentId)) {
        if (settingsOpenRef.current) return;
        try {
          await agentBridge.showWebview(agentId, bounds);
          for (const other of agents) {
            if (other.id === agentId) continue;
            if (!webviewsCreatedRef.current.has(other.id)) continue;
            try {
              await agentBridge.hideWebview(other.id);
            } catch {
              // 未创建可忽略
            }
          }
          return;
        } catch {
          webviewsCreatedRef.current.delete(agentId);
        }
      }

      let defaultScript: string;
      try {
        defaultScript = await fileService.readBridgeScript('scripts/bridge-default.js');
      } catch {
        console.warn('未找到 bridge-default.js，请添加到 scripts。');
        return;
      }

      try {
        const bridgeScript = await fileService.readBridgeScript(
          agent.injectScript.replace(/^scripts\//, 'scripts/')
        );
        await agentBridge.createWebview(agent, bounds, bridgeScript, defaultScript);
        webviewsCreatedRef.current.add(agentId);
      } catch (err) {
        console.warn(`Agent script load failed: ${agentId}`, err);
        return;
      }

      await syncAgentWebviewVisibility();
    },
    [workspaceRoot, agents, syncAgentWebviewVisibility]
  );

  const handleSelectAgent = useCallback(
    async (agentId: string) => {
      activeAgentIdRef.current = agentId;
      setActiveAgentId(agentId);
      if (!workspaceRoot) return;
      await ensureAgentWebview(agentId);
    },
    [workspaceRoot, ensureAgentWebview]
  );

  // 打开工作区后加载当前选中的 Agent
  useEffect(() => {
    if (!workspaceRoot || !activeAgentId) return;
    void ensureAgentWebview(activeAgentId);
  }, [workspaceRoot, activeAgentId, ensureAgentWebview]);

  useEffect(() => {
    initConfig().catch(console.error);
    conversationLogService.init().then((path) => {
      setChatLogFilePath(path);
    }).catch(console.error);

    return () => {
      configLoaderRef.current?.stopWatch();
    };
  }, [initConfig]);

  useEffect(() => {
    agentBridge.onResponse(handleAgentResponse);
    agentBridge.onChatMessage(handleChatMessage);
    agentBridge.onBridgeComm(handleBridgeComm);
  }, [handleAgentResponse, handleChatMessage, handleBridgeComm]);

  useEffect(() => {
    return () => {
      incompleteConfirmRef.current.clearAll();
      agentBridge.destroy();
    };
  }, []);

  const handleOpen = useCallback(async () => {
    try {
      const result = await fileService.openFileDialog();
      if (result) {
        setContent(result.content);
        setFilePath(result.path);
        setIsDirty(false);
      }
    } catch (err) {
      console.error(err);
      await message('无法读取该文件，可能不是文本文件。', {
        title: '打开失败',
        kind: 'error',
      });
    }
  }, []);

  const handleOpenFolder = useCallback(async () => {
    const folder = await fileService.openFolderDialog();
    if (folder) {
      const root = normalizeWorkspaceRoot(fileService.getWorkspaceRoot());
      userWorkspaceRef.current = root;
      setWorkspaceRoot(root);
      conversationLogService.resetLogTarget();
      loggedToolCaptureRef.current.clear();
      conversationLogService.init().then((path) => setChatLogFilePath(path)).catch(console.error);
      setTreeRefreshKey((key) => key + 1);
    }
  }, []);

  const handleOpenFileFromTree = useCallback(
    async (path: string) => {
      if (path === filePath) return;
      if (isDirty) {
        const confirmed = await ask('当前文件有未保存的修改，是否继续打开？', {
          title: '未保存的修改',
          kind: 'warning',
        });
        if (!confirmed) return;
      }
      try {
        const fileContent = await fileService.readFile(path);
        setContent(fileContent);
        setFilePath(path);
        setIsDirty(false);
      } catch (err) {
        console.error(err);
        await message('无法读取该文件，可能不是文本文件。', {
          title: '打开失败',
          kind: 'error',
        });
      }
    },
    [filePath, isDirty]
  );

  const handleSave = useCallback(async () => {
    const saved = await fileService.saveFileDialog(filePath, content);
    if (saved) {
      setFilePath(saved);
      setIsDirty(false);
    }
  }, [filePath, content]);

  const handleSaveAs = useCallback(async () => {
    const saved = await fileService.saveAsDialog(content);
    if (saved) {
      setFilePath(saved);
      setIsDirty(false);
    }
  }, [content]);

  const buildFileMessage = useCallback(
    (text: string, absolutePath?: string | null) => {
      const path = absolutePath ?? filePath;
      const displayPath = path ? toRelativePath(path, workspaceRoot) : '';
      const pathPart = displayPath ? `文件: ${displayPath}\n\n` : '';
      return `${pathPart}\`\`\`\n${text}\n\`\`\``;
    },
    [filePath, workspaceRoot]
  );

  const handleSendCurrentFile = useCallback(async () => {
    if (!workspaceRoot || !activeAgentId) return;
    await logAndFillAgent(buildFileMessage(content), '填入当前文件');
  }, [workspaceRoot, activeAgentId, content, buildFileMessage, logAndFillAgent]);

  const handleSendSelection = useCallback(
    async (override?: EditorSelectionInfo) => {
      const info = override ?? selection;
      if (!workspaceRoot || !activeAgentId || !info.text) return;
      const displayPath = filePath ? toRelativePath(filePath, workspaceRoot) : '';
      const msg = buildSelectionMessage({
        path: displayPath || null,
        startLine: info.startLine,
        endLine: info.endLine,
        text: info.text,
      });
      await logAndFillAgent(msg, '填入选中内容');
    },
    [workspaceRoot, activeAgentId, selection, filePath, logAndFillAgent]
  );

  const handleRefreshTree = useCallback(() => {
    setTreeRefreshKey((key) => key + 1);
  }, []);

  const handleSendFileToAgent = useCallback(
    async (path: string) => {
      if (!workspaceRoot) {
        await message('请先打开工作区。', { title: '提示', kind: 'warning' });
        return;
      }
      if (!activeAgentId) {
        await message('请先选择一个 Agent。', { title: '提示', kind: 'warning' });
        return;
      }
      try {
        const fileContent = await fileService.readFile(path);
        await logAndFillAgent(buildFileMessage(fileContent, path), '填入文件到 Agent');
      } catch (err) {
        console.error(err);
        await message('无法读取该文件，可能不是文本文件。', {
          title: '填入失败',
          kind: 'error',
        });
      }
    },
    [workspaceRoot, activeAgentId, buildFileMessage, logAndFillAgent]
  );

  const handleDeletePath = useCallback(
    async (path: string) => {
      const confirmed = await ask(`确定删除？\n${path}`, {
        title: '删除确认',
        kind: 'warning',
      });
      if (!confirmed) return;
      try {
        await fileService.deletePath(path);
        if (
          filePath &&
          (filePath === path ||
            filePath.startsWith(path.replace(/[/\\]+$/, '') + '\\') ||
            filePath.startsWith(path.replace(/[/\\]+$/, '') + '/'))
        ) {
          setContent('');
          setFilePath(null);
          setIsDirty(false);
        }
        setTreeRefreshKey((key) => key + 1);
      } catch (err) {
        console.error(err);
        await message(`删除失败：${String(err)}`, {
          title: '删除失败',
          kind: 'error',
        });
      }
    },
    [filePath]
  );

  const handleOpenSettings = useCallback(() => {
    setSettingsDraft({ ...toolPermissionsRef.current });
    settingsOpenRef.current = true;
    setSettingsOpen(true);
    void hideAllAgentWebviews();
  }, [hideAllAgentWebviews]);

  const handleCloseSettings = useCallback(() => {
    settingsOpenRef.current = false;
    setSettingsOpen(false);
    void syncAgentWebviewVisibility();
  }, [syncAgentWebviewVisibility]);

  const handleSettingsPermChange = useCallback((toolName: string, mode: ToolPermissionMode) => {
    setSettingsDraft((prev) => ({ ...prev, [toolName]: mode }));
  }, []);

  const handleSaveSettings = useCallback(async () => {
    setSettingsSaving(true);
    try {
      const raw = await fileService.readConfigFile('config/app.config.json');
      const parsed = JSON.parse(raw) as AppConfig;
      const next: AppConfig = {
        ...parsed,
        toolPermissions: mergeToolPermissions(settingsDraft),
      };
      await fileService.writeConfigFile(
        'config/app.config.json',
        JSON.stringify(next, null, 2) + '\n'
      );
      toolPermissionsRef.current = next.toolPermissions!;
      setSettingsDraft(next.toolPermissions!);
      settingsOpenRef.current = false;
      setSettingsOpen(false);
      void syncAgentWebviewVisibility();
    } catch (err) {
      await message(`保存失败：${String(err)}`, { title: '设置', kind: 'error' });
    } finally {
      setSettingsSaving(false);
    }
  }, [settingsDraft, syncAgentWebviewVisibility]);

  const handleSendAgentMode = useCallback(async () => {
    if (!workspaceRoot) return;
    const targetId = activeAgentIdRef.current;
    if (!targetId) return;
    const agent = agentsRef.current.find((a) => a.id === targetId);
    const msg = buildAgentModePrompt(
      workspaceRoot || undefined,
      agent?.readFileLineLimit,
      toolPermissionsRef.current,
      agent?.writeFileLineLimit
    );
    setAgentModeEnabled(true);
    await logAndSendToAgent(msg, 'Agent 模式', targetId);
  }, [workspaceRoot, logAndSendToAgent]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    setupDebugController({
      click: {
        'open-file': () => handleOpen(),
        'open-folder': () => handleOpenFolder(),
        save: () => handleSave(),
        'save-as': () => handleSaveAs(),
        'send-current-file': () => handleSendCurrentFile(),
        'send-selection': () => handleSendSelection(),
        'agent-mode': () => handleSendAgentMode(),
      },
      openFolder: async (path?: string) => {
        if (path) {
          const root = normalizeWorkspaceRoot(path);
          userWorkspaceRef.current = root;
          fileService.setWorkspaceRoot(root);
          setWorkspaceRoot(root);
          conversationLogService.resetLogTarget();
          loggedToolCaptureRef.current.clear();
          const logPath = await conversationLogService.init();
          setChatLogFilePath(logPath);
          setTreeRefreshKey((key) => key + 1);
          return;
        }
        await handleOpenFolder();
      },
      selectAgent: (agentId: string) => {
        void handleSelectAgent(agentId);
      },
      sendPrompt: async (text: string, agentId?: string) => {
        const targetId = agentId || activeAgentIdRef.current;
        if (!targetId || !workspaceRoot) return;
        if (agentId) {
          await handleSelectAgent(agentId);
        } else {
          await ensureAgentWebview(targetId);
        }
        await logAndSendToAgent(text, 'Debug CLI', targetId);
      },
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [
    handleOpen,
    handleOpenFolder,
    handleSave,
    handleSaveAs,
    handleSendCurrentFile,
    handleSendSelection,
    handleSendAgentMode,
    logAndSendToAgent,
    handleSelectAgent,
    ensureAgentWebview,
    workspaceRoot,
  ]);

  const handleClearChatLog = useCallback(() => {
    conversationLogService.clear();
    refreshChatLog();
  }, [refreshChatLog]);

  const handleBoundsChange = useCallback(
    (bounds: { x: number; y: number; width: number; height: number }) => {
      boundsRef.current = bounds;
      if (settingsOpenRef.current) return;
      if (activeAgentId) {
        agentBridge.showWebview(activeAgentId, bounds).catch(console.error);
      }
    },
    [activeAgentId]
  );

  const getMaxFileTreeWidth = useCallback(() => {
    if (mainContentWidth <= 0) return FILE_TREE_MIN_WIDTH;
    return Math.max(
      FILE_TREE_MIN_WIDTH,
      mainContentWidth - agentPanelWidth - RESIZE_HANDLE_TOTAL_WIDTH - EDITOR_MIN_WIDTH
    );
  }, [mainContentWidth, agentPanelWidth]);

  const getMaxAgentPanelWidth = useCallback(() => {
    if (mainContentWidth <= 0) return AGENT_PANEL_MIN_WIDTH;
    return Math.max(
      AGENT_PANEL_MIN_WIDTH,
      mainContentWidth - fileTreeWidth - RESIZE_HANDLE_TOTAL_WIDTH - EDITOR_MIN_WIDTH
    );
  }, [mainContentWidth, fileTreeWidth]);

  useEffect(() => {
    const el = mainContentRef.current;
    if (!el) return;

    const updateWidth = () => setMainContentWidth(el.clientWidth);
    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    window.addEventListener('resize', updateWidth);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateWidth);
    };
  }, []);

  useEffect(() => {
    if (mainContentWidth <= 0) return;

    const maxFileTree = Math.max(
      FILE_TREE_MIN_WIDTH,
      mainContentWidth - agentPanelWidth - RESIZE_HANDLE_TOTAL_WIDTH - EDITOR_MIN_WIDTH
    );
    const maxAgent = Math.max(
      AGENT_PANEL_MIN_WIDTH,
      mainContentWidth - fileTreeWidth - RESIZE_HANDLE_TOTAL_WIDTH - EDITOR_MIN_WIDTH
    );

    if (fileTreeWidth > maxFileTree) {
      setFileTreeWidth(maxFileTree);
    }
    if (agentPanelWidth > maxAgent) {
      setAgentPanelWidth(maxAgent);
    }
  }, [mainContentWidth, fileTreeWidth, agentPanelWidth]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'o') {
        e.preventDefault();
        handleOpen();
      }
      if (e.ctrlKey && e.key === 's' && e.shiftKey) {
        e.preventDefault();
        handleSaveAs();
      } else if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
      if (e.ctrlKey && e.shiftKey && e.key === 'A') {
        e.preventDefault();
        handleSendSelection();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleOpen, handleSave, handleSaveAs, handleSendSelection]);

  const activeStatus = activeAgentId ? agentBridge.getStatus(activeAgentId) : 'idle';

  return (
    <div className="app">
      <header className="menu-bar">
        <div className="menu-group">
          <span className="menu-label">文件</span>
          <button onClick={handleOpen}>打开 (Ctrl+O)</button>
          <button onClick={handleOpenFolder}>打开文件夹</button>
          <button onClick={handleSave}>保存 (Ctrl+S)</button>
          <button onClick={handleSaveAs}>另存为 (Ctrl+Shift+S)</button>
        </div>
        <div className="menu-group">
          <span className="menu-label">Agent</span>
          <button onClick={handleSendCurrentFile} disabled={!workspaceRoot}>
            填入当前文件
          </button>
          <button onClick={() => handleSendSelection()} disabled={!workspaceRoot}>
            填入选中 (Ctrl+Shift+A)
          </button>
          <button
            className={agentModeEnabled ? 'agent-mode-btn active' : 'agent-mode-btn'}
            onClick={handleSendAgentMode}
            disabled={!workspaceRoot}
          >
            Agent 模式
          </button>
          <button onClick={() => void handleKillTerminal()} title="终止所有 run_powershell 进程">
            终止终端
          </button>
          <button onClick={handleOpenSettings}>设置</button>
        </div>
      </header>

      <main className="main-content" ref={mainContentRef}>
        <FileTree
          width={fileTreeWidth}
          workspaceRoot={workspaceRoot}
          activeFilePath={filePath}
          refreshKey={treeRefreshKey}
          fileService={fileService}
          onOpenFile={handleOpenFileFromTree}
          onOpenFolder={handleOpenFolder}
          onRefresh={handleRefreshTree}
          onSendFileToAgent={handleSendFileToAgent}
          onDeletePath={handleDeletePath}
        />

        <ResizeHandle
          getStartValue={() => fileTreeWidth}
          onValueChange={setFileTreeWidth}
          min={FILE_TREE_MIN_WIDTH}
          getMax={getMaxFileTreeWidth}
        />

        <section className="editor-section">
          <div className="editor-header">
            <span className="file-path">{filePath || '未打开文件'}</span>
            {isDirty && <span className="dirty-indicator">● 已修改</span>}
          </div>
          <div className="editor-body">
            <Editor
              content={content}
              filePath={filePath}
              theme={theme}
              tabSize={tabSize}
              onChange={handleContentChange}
              onSelectionChange={setSelection}
              onSendSelection={handleSendSelection}
              onSendCurrentFile={handleSendCurrentFile}
              onSave={handleSave}
            />
          </div>
          <ChatLogPanel
            entries={chatLogEntries}
            logFilePath={chatLogFilePath}
            onClear={handleClearChatLog}
          />
        </section>

        <ResizeHandle
          getStartValue={() => agentPanelWidth}
          onValueChange={setAgentPanelWidth}
          min={AGENT_PANEL_MIN_WIDTH}
          getMax={getMaxAgentPanelWidth}
          invert
        />

        <AgentPanel
          width={agentPanelWidth}
          agents={agents}
          activeAgentId={activeAgentId}
          agentStatuses={agentStatuses}
          logEntries={logEntries}
          workspaceReady={!!workspaceRoot}
          onSelectAgent={handleSelectAgent}
          onBoundsChange={handleBoundsChange}
        />
      </main>

      <footer className="status-bar">
        <span>{filePath || '无文件'}</span>
        <span>UTF-8</span>
        <span>Agent: {activeStatus}</span>
        <span>{agentModeEnabled ? 'Agent 模式: 开' : 'Agent 模式: 关'}</span>
        <span>上次同步: {lastSync ? lastSync.toLocaleTimeString() : '—'}</span>
      </footer>

      <SettingsPanel
        open={settingsOpen}
        permissions={settingsDraft}
        onChange={handleSettingsPermChange}
        onSave={() => void handleSaveSettings()}
        onClose={handleCloseSettings}
        saving={settingsSaving}
      />
    </div>
  );
}
