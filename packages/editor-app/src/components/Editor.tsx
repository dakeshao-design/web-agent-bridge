import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorSelection, EditorState } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
} from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  undo,
  redo,
  selectAll,
} from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { cpp } from '@codemirror/lang-cpp';
import { oneDark } from '@codemirror/theme-one-dark';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language';
import { ContextMenu, type ContextMenuItem, type ContextMenuState } from './ContextMenu';

interface EditorProps {
  content: string;
  filePath: string | null;
  theme: string;
  tabSize: number;
  onChange: (content: string) => void;
  onSelectionChange?: (selection: EditorSelectionInfo) => void;
  onSendSelection?: (selection: EditorSelectionInfo) => void;
  onSendCurrentFile?: () => void;
  onSave?: () => void;
}

export type EditorSelectionInfo = {
  text: string;
  startLine: number;
  endLine: number;
};

function getLanguageExtension(filePath: string | null) {
  if (!filePath) return [];
  const ext = filePath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'js':
    case 'jsx':
    case 'ts':
    case 'tsx':
      return [javascript({ typescript: ext === 'ts' || ext === 'tsx', jsx: ext === 'jsx' || ext === 'tsx' })];
    case 'json':
      return [json()];
    case 'md':
      return [markdown()];
    case 'cs':
    case 'cpp':
    case 'c':
    case 'h':
      return [cpp()];
    default:
      return [];
  }
}

function getSelectedText(view: EditorView): string {
  const ranges = view.state.selection.ranges;
  return ranges
    .filter((r) => !r.empty)
    .map((r) => view.state.doc.sliceString(r.from, r.to))
    .join('\n');
}

/** 选区行号：1-based 闭区间；多 range 取并集 */
function getSelectionInfo(view: EditorView): EditorSelectionInfo {
  const doc = view.state.doc;
  const nonEmpty = view.state.selection.ranges.filter((r) => !r.empty);
  if (nonEmpty.length === 0) {
    return { text: '', startLine: 1, endLine: 1 };
  }

  let from = nonEmpty[0].from;
  let to = nonEmpty[0].to;
  for (const r of nonEmpty) {
    from = Math.min(from, r.from);
    to = Math.max(to, r.to);
  }

  let startLine = doc.lineAt(from).number;
  let endLine = doc.lineAt(to).number;
  // 选到下一行行首时不计入该行
  const endLineInfo = doc.lineAt(to);
  if (to > from && to === endLineInfo.from && endLine > startLine) {
    endLine -= 1;
  }

  return {
    text: getSelectedText(view),
    startLine,
    endLine,
  };
}

export function Editor({
  content,
  filePath,
  theme,
  tabSize,
  onChange,
  onSelectionChange,
  onSendSelection,
  onSendCurrentFile,
  onSave,
}: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const extensions = [
      lineNumbers(),
      highlightActiveLine(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      rectangularSelection(),
      crosshairCursor(),
      bracketMatching(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      EditorState.tabSize.of(tabSize),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChange(update.state.doc.toString());
        }
        if (update.selectionSet && onSelectionChange) {
          onSelectionChange(getSelectionInfo(update.view));
        }
      }),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      ...getLanguageExtension(filePath),
    ];

    if (theme === 'one-dark') {
      extensions.push(oneDark);
    }

    const state = EditorState.create({
      doc: content,
      extensions,
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [filePath, theme, tabSize]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== content) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: content },
      });
    }
  }, [content]);

  const closeMenu = useCallback(() => setMenu(null), []);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const view = viewRef.current;
      if (!view) return;

      const info = getSelectionInfo(view);
      const hasSel = info.text.length > 0;

      const items: ContextMenuItem[] = [
        {
          type: 'item',
          id: 'cut',
          label: '剪切',
          disabled: !hasSel,
          onClick: () => {
            void navigator.clipboard.writeText(info.text).then(() => {
              const { from, to } = view.state.selection.main;
              view.dispatch({
                changes: { from, to, insert: '' },
                selection: EditorSelection.cursor(from),
              });
              view.focus();
            });
          },
        },
        {
          type: 'item',
          id: 'copy',
          label: '复制',
          disabled: !hasSel,
          onClick: () => {
            void navigator.clipboard.writeText(info.text);
          },
        },
        {
          type: 'item',
          id: 'paste',
          label: '粘贴',
          onClick: () => {
            void navigator.clipboard.readText().then((text) => {
              const { from, to } = view.state.selection.main;
              view.dispatch({
                changes: { from, to, insert: text },
                selection: EditorSelection.cursor(from + text.length),
              });
              view.focus();
            });
          },
        },
        { type: 'separator', id: 'sep-edit' },
        {
          type: 'item',
          id: 'undo',
          label: '撤销',
          onClick: () => {
            undo(view);
            view.focus();
          },
        },
        {
          type: 'item',
          id: 'redo',
          label: '重做',
          onClick: () => {
            redo(view);
            view.focus();
          },
        },
        {
          type: 'item',
          id: 'select-all',
          label: '全选',
          onClick: () => {
            selectAll(view);
            view.focus();
          },
        },
        { type: 'separator', id: 'sep-agent' },
        {
          type: 'item',
          id: 'send-selection',
          label: '填入选中到 Agent',
          disabled: !hasSel || !onSendSelection,
          onClick: () => onSendSelection?.(info),
        },
        {
          type: 'item',
          id: 'send-file',
          label: '填入当前文件到 Agent',
          disabled: !onSendCurrentFile,
          onClick: () => onSendCurrentFile?.(),
        },
        { type: 'separator', id: 'sep-file' },
        {
          type: 'item',
          id: 'save',
          label: '保存',
          disabled: !onSave,
          onClick: () => onSave?.(),
        },
      ];

      setMenu({ x: e.clientX, y: e.clientY, items });
    },
    [onSave, onSendCurrentFile, onSendSelection]
  );

  return (
    <div className="editor-container" onContextMenu={handleContextMenu}>
      <div ref={containerRef} className="editor-cm-host" />
      <ContextMenu menu={menu} onClose={closeMenu} />
    </div>
  );
}

export function getEditorSelection(view: EditorView | null): string {
  if (!view) return '';
  return getSelectedText(view);
}
