import { useCallback, useEffect, useRef, useState } from 'react';
import type { FileTreeEntry } from '../services/TauriFileService';
import { TauriFileService } from '../services/TauriFileService';
import { toRelativePath } from '../services/file/pathUtils';
import { ContextMenu, type ContextMenuItem, type ContextMenuState } from './ContextMenu';

const POLL_INTERVAL_MS = 3000;

interface FileTreeNodeProps {
  entry: FileTreeEntry;
  depth: number;
  activeFilePath: string | null;
  dataVersion: number;
  expanded: boolean;
  isPathExpanded: (path: string) => boolean;
  onToggleExpand: (path: string) => void;
  fileService: TauriFileService;
  onOpenFile: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, entry: FileTreeEntry) => void;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase();
}

function entriesFingerprint(entries: FileTreeEntry[]): string {
  return entries
    .map((e) => `${normalizePath(e.path)}\0${e.isDirectory ? 'd' : 'f'}\0${e.name}`)
    .join('\n');
}

function FileTreeNode({
  entry,
  depth,
  activeFilePath,
  dataVersion,
  expanded,
  isPathExpanded,
  onToggleExpand,
  fileService,
  onOpenFile,
  onContextMenu,
}: FileTreeNodeProps) {
  const [children, setChildren] = useState<FileTreeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const fingerprintRef = useRef('');
  const hasChildrenRef = useRef(false);
  hasChildrenRef.current = children.length > 0;

  const loadChildren = useCallback(
    async (silent: boolean) => {
      if (!silent) setLoading(true);
      try {
        const next = await fileService.listDirectory(entry.path);
        const fp = entriesFingerprint(next);
        if (fp !== fingerprintRef.current) {
          fingerprintRef.current = fp;
          setChildren(next);
        }
      } catch (err) {
        console.error(err);
        fingerprintRef.current = '';
        setChildren([]);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [entry.path, fileService]
  );

  useEffect(() => {
    if (!expanded || !entry.isDirectory) return;
    void loadChildren(hasChildrenRef.current);
  }, [expanded, entry.isDirectory, loadChildren, dataVersion]);

  const handleClick = () => {
    if (entry.isDirectory) {
      onToggleExpand(entry.path);
      return;
    }
    onOpenFile(entry.path);
  };

  const isActive =
    !entry.isDirectory &&
    !!activeFilePath &&
    normalizePath(activeFilePath) === normalizePath(entry.path);

  return (
    <div className="file-tree-node">
      <button
        type="button"
        className={`file-tree-item ${isActive ? 'active' : ''}`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={handleClick}
        onContextMenu={(e) => onContextMenu(e, entry)}
        title={entry.path}
      >
        <span className="file-tree-icon">
          {entry.isDirectory ? (expanded ? '▾' : '▸') : '📄'}
        </span>
        <span className="file-tree-name">{entry.name}</span>
      </button>
      {entry.isDirectory && expanded && (
        <div className="file-tree-children">
          {loading && children.length === 0 && (
            <div className="file-tree-loading">加载中...</div>
          )}
          {children.map((child) => (
            <FileTreeNode
              key={normalizePath(child.path)}
              entry={child}
              depth={depth + 1}
              activeFilePath={activeFilePath}
              dataVersion={dataVersion}
              expanded={isPathExpanded(child.path)}
              isPathExpanded={isPathExpanded}
              onToggleExpand={onToggleExpand}
              fileService={fileService}
              onOpenFile={onOpenFile}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface FileTreeProps {
  width: number;
  workspaceRoot: string;
  activeFilePath: string | null;
  refreshKey: number;
  fileService: TauriFileService;
  onOpenFile: (path: string) => void;
  onOpenFolder: () => void;
  onRefresh: () => void;
  onSendFileToAgent: (path: string) => void;
  onDeletePath: (path: string) => void;
}

export function FileTree({
  width,
  workspaceRoot,
  activeFilePath,
  refreshKey,
  fileService,
  onOpenFile,
  onOpenFolder,
  onRefresh,
  onSendFileToAgent,
  onDeletePath,
}: FileTreeProps) {
  const [entries, setEntries] = useState<FileTreeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const rootFingerprintRef = useRef('');
  const workspaceRootRef = useRef(workspaceRoot);

  const isPathExpanded = useCallback(
    (path: string) => expandedPaths.has(normalizePath(path)),
    [expandedPaths]
  );

  const onToggleExpand = useCallback((path: string) => {
    const key = normalizePath(path);
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const reloadRoot = useCallback(
    async (showLoading: boolean) => {
      if (!workspaceRoot) {
        setEntries([]);
        rootFingerprintRef.current = '';
        return;
      }

      if (showLoading) setLoading(true);
      try {
        const next = await fileService.listDirectory(workspaceRoot);
        const fp = entriesFingerprint(next);
        if (fp !== rootFingerprintRef.current) {
          rootFingerprintRef.current = fp;
          setEntries(next);
        }
        // 促使已展开节点重新加载
        setDataVersion((v) => v + 1);
      } catch (err) {
        console.error(err);
        rootFingerprintRef.current = '';
        setEntries([]);
        setDataVersion((v) => v + 1);
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [workspaceRoot, fileService]
  );

  // 切换工作区时重置展开并初次加载
  useEffect(() => {
    if (workspaceRootRef.current !== workspaceRoot) {
      workspaceRootRef.current = workspaceRoot;
      setExpandedPaths(new Set());
      rootFingerprintRef.current = '';
      setEntries([]);
      setDataVersion(0);
    }
    if (!workspaceRoot) {
      setEntries([]);
      return;
    }
    void reloadRoot(true);
    // reloadRoot 随 workspaceRoot / fileService 更新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceRoot, fileService]);

  // 手动或操作后立即更新
  const refreshKeyRef = useRef(refreshKey);
  useEffect(() => {
    if (refreshKeyRef.current === refreshKey) return;
    refreshKeyRef.current = refreshKey;
    if (!workspaceRoot) return;
    void reloadRoot(false);
  }, [refreshKey, workspaceRoot, reloadRoot]);

  // 每 3 秒轮询
  useEffect(() => {
    if (!workspaceRoot) return;
    const timer = window.setInterval(() => {
      void reloadRoot(false);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [workspaceRoot, reloadRoot]);

  const closeMenu = useCallback(() => setMenu(null), []);

  const copyPath = useCallback(async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
    } catch (err) {
      console.error(err);
    }
  }, []);

  const openBlankMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const items: ContextMenuItem[] = [
        {
          type: 'item',
          id: 'open-folder',
          label: '打开文件夹',
          onClick: onOpenFolder,
        },
        {
          type: 'item',
          id: 'refresh',
          label: '刷新',
          disabled: !workspaceRoot,
          onClick: onRefresh,
        },
      ];
      setMenu({ x: e.clientX, y: e.clientY, items });
    },
    [onOpenFolder, onRefresh, workspaceRoot]
  );

  const openEntryMenu = useCallback(
    (e: React.MouseEvent, entry: FileTreeEntry) => {
      e.preventDefault();
      e.stopPropagation();
      const items: ContextMenuItem[] = [];

      if (!entry.isDirectory) {
        items.push({
          type: 'item',
          id: 'open',
          label: '打开',
          onClick: () => onOpenFile(entry.path),
        });
      }

      items.push({
        type: 'item',
        id: 'copy-path',
        label: '复制路径',
        onClick: () => {
          void copyPath(entry.path);
        },
      });
      items.push({
        type: 'item',
        id: 'copy-relative-path',
        label: '复制相对路径',
        onClick: () => {
          void copyPath(toRelativePath(entry.path, workspaceRoot));
        },
      });

      if (!entry.isDirectory) {
        items.push({
          type: 'item',
          id: 'send-agent',
          label: '填入 Agent 输入框',
          onClick: () => onSendFileToAgent(entry.path),
        });
      }

      items.push({ type: 'separator', id: 'sep-delete' });
      items.push({
        type: 'item',
        id: 'delete',
        label: entry.isDirectory ? '删除文件夹' : '删除文件',
        danger: true,
        onClick: () => onDeletePath(entry.path),
      });

      setMenu({ x: e.clientX, y: e.clientY, items });
    },
    [copyPath, onDeletePath, onOpenFile, onSendFileToAgent, workspaceRoot]
  );

  const folderName = workspaceRoot
    ? workspaceRoot.replace(/\\/g, '/').split('/').pop() || workspaceRoot
    : '';

  return (
    <aside className="file-tree-sidebar" style={{ width }} onContextMenu={openBlankMenu}>
      <div className="file-tree-header">
        <span className="file-tree-title">资源管理器</span>
        <button type="button" className="file-tree-action" onClick={onOpenFolder} title="打开文件夹">
          📁
        </button>
      </div>
      {!workspaceRoot ? (
        <div className="file-tree-empty">
          <p>尚未打开工作区</p>
          <button type="button" className="btn-secondary" onClick={onOpenFolder}>
            打开文件夹
          </button>
        </div>
      ) : (
        <>
          <div
            className="file-tree-root"
            title={workspaceRoot}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenu({
                x: e.clientX,
                y: e.clientY,
                items: [
                  {
                    type: 'item',
                    id: 'copy-root',
                    label: '复制路径',
                    onClick: () => {
                      void copyPath(workspaceRoot);
                    },
                  },
                  {
                    type: 'item',
                    id: 'copy-root-relative',
                    label: '复制相对路径',
                    onClick: () => {
                      void copyPath(toRelativePath(workspaceRoot, workspaceRoot));
                    },
                  },
                  {
                    type: 'item',
                    id: 'refresh-root',
                    label: '刷新',
                    onClick: onRefresh,
                  },
                  {
                    type: 'item',
                    id: 'open-folder-root',
                    label: '打开其他文件夹',
                    onClick: onOpenFolder,
                  },
                ],
              });
            }}
          >
            {folderName}
          </div>
          <div className="file-tree-list">
            {loading && entries.length === 0 && (
              <div className="file-tree-loading">加载中...</div>
            )}
            {entries.map((entry) => (
              <FileTreeNode
                key={normalizePath(entry.path)}
                entry={entry}
                depth={0}
                activeFilePath={activeFilePath}
                dataVersion={dataVersion}
                expanded={isPathExpanded(entry.path)}
                isPathExpanded={isPathExpanded}
                onToggleExpand={onToggleExpand}
                fileService={fileService}
                onOpenFile={onOpenFile}
                onContextMenu={openEntryMenu}
              />
            ))}
          </div>
        </>
      )}
      <ContextMenu menu={menu} onClose={closeMenu} />
    </aside>
  );
}
