/**
 * Agent bridge default implementation
 */
(function () {
  'use strict';

  const BRIDGE_NS = '__agentEditorBridge';

  if (window[BRIDGE_NS]) return;

  function createBridge() {
    const REGISTER_NS = '__agentEditorBridgeRegister';

    const state = {
      lastResponse: '',
      stableSince: 0,
      watchTimer: null,
      responseCallback: null,
      responsePosted: false,
      seenChange: false,
      pollIntervalMs: 1000,
      stableMs: 2000,
      responseBaseline: '',
      responseBaselineKey: -1,
      inputMode: 'fill',
      typeDelayMs: 0,
      waitBeforeSend: 300,
      typeStrategy: 'keyboard',
      agentId: '',
      sendCaptureInstalled: false,
      inputLimitObserver: null,
      inputLimitRemoverScheduled: false,
      readFileLineLimit: 0,
      writeFileLineLimit: 0,
      site: null,
      copiedToolText: '',
      copiedToolAt: 0,
      copyReadInFlight: false,
      copyReadBlockRef: '',
      copyReadFailCounts: {},
      pinnedToolText: '',
      pinnedToolAt: 0,
      lastCopyLogKey: '',
      pendingCommLogs: [],
      pendingChatMessages: [],
      pendingResetBaseline: false,
      // null | 'running' | { ok, error? }
      newChatStatus: null,
      newChatOnload: false,
      newChatOnloadStarted: false,
      newChatOnloadTimer: null,
      pendingNewChatOnloadAgentMode: false,
    };

    function registerSiteBridge(site) {
      if (!site || typeof site !== 'object') return;
      state.site = site;
      if (typeof site.readFileLineLimit === 'number' && site.readFileLineLimit > 0) {
        state.readFileLineLimit = site.readFileLineLimit;
      }
      if (typeof site.writeFileLineLimit === 'number' && site.writeFileLineLimit > 0) {
        state.writeFileLineLimit = site.writeFileLineLimit;
      }
      if (typeof site.newChatOnload === 'boolean') {
        state.newChatOnload = site.newChatOnload;
      }
      maybeStartNewChatOnload();
    }

    function getSite() {
      return state.site || null;
    }

    function resolveCurrentDocument() {
      const site = getSite();
      if (site && typeof site.resolveCurrentDocument === 'function') {
        try {
          const doc = site.resolveCurrentDocument();
          if (doc) return doc;
        } catch (err) {
          console.warn('[bridge] resolveCurrentDocument failed', err);
        }
      }
      return document;
    }

    function defaultPollSnapshot(doc) {
      const scope = doc || document;
      const nodes = scope.querySelectorAll(
        '[class*="markdown"], [data-message-author-role="assistant"], [class*="assistant"]'
      );
      let lastAgent = null;
      let responseRoot = null;
      if (nodes.length) {
        const last = nodes[nodes.length - 1];
        const text = (last.innerText || last.textContent || '').trim();
        if (text) {
          lastAgent = { index: 0, text };
          responseRoot = last;
        }
      }
      return {
        loading: false,
        lastUser: null,
        lastAgent,
        responseRoot,
      };
    }

    function normalizeMessage(msg) {
      if (!msg || typeof msg !== 'object') return null;
      const text = String(msg.text || '').trim();
      if (!text) return null;
      const index = Number(msg.index);
      return {
        index: Number.isFinite(index) ? index : -1,
        text,
      };
    }

    function runPollSnapshot() {
      const doc = resolveCurrentDocument();
      const site = getSite();
      let snap = null;
      if (site && typeof site.pollSnapshot === 'function') {
        try {
          snap = site.pollSnapshot(doc);
        } catch (err) {
          console.warn('[bridge] pollSnapshot failed', err);
          snap = null;
        }
      }
      if (!snap || typeof snap !== 'object') {
        snap = defaultPollSnapshot(doc);
      }

      if (snap.loading) {
        return {
          loading: true,
          lastUser: null,
          lastAgent: null,
          responseRoot: null,
        };
      }

      return {
        loading: false,
        lastUser: normalizeMessage(snap.lastUser),
        lastAgent: normalizeMessage(snap.lastAgent),
        responseRoot: snap.responseRoot || null,
      };
    }

    function pollSnapshotForHost() {
      const s = runPollSnapshot();
      return {
        loading: !!s.loading,
        lastUser: s.lastUser
          ? { index: Number(s.lastUser.index), text: String(s.lastUser.text || '') }
          : null,
        lastAgent: s.lastAgent
          ? { index: Number(s.lastAgent.index), text: String(s.lastAgent.text || '') }
          : null,
      };
    }

    function defaultGetComposer(doc) {
      const scope = doc || document;
      return {
        input: scope.querySelector('textarea'),
        sendButton: scope.querySelector("button[type='submit']"),
      };
    }

    function getComposer(doc) {
      const scope = doc || resolveCurrentDocument();
      const site = getSite();
      if (site && typeof site.getComposer === 'function') {
        try {
          const result = site.getComposer(scope);
          if (result && typeof result === 'object') {
            return {
              input: result.input || null,
              sendButton: result.sendButton || null,
            };
          }
        } catch (err) {
          console.warn('[bridge] getComposer failed', err);
        }
      }
      return defaultGetComposer(scope);
    }

    function queryInput() {
      return getComposer(resolveCurrentDocument()).input;
    }

    function querySendButton() {
      return getComposer(resolveCurrentDocument()).sendButton;
    }

    function unlockInputElement(el) {
      if (!el || !(el instanceof HTMLElement)) return;
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        el.removeAttribute('maxlength');
        el.removeAttribute('maxLength');
      }
      ['data-maxlength', 'data-max-length', 'data-limit', 'data-max'].forEach((attr) => {
        el.removeAttribute(attr);
      });
      if (el.isContentEditable && el.dataset.agentEditorLimitUnlocked !== '1') {
        el.dataset.agentEditorLimitUnlocked = '1';
      }
    }

    function scheduleRemoveInputLimits() {
      if (state.inputLimitRemoverScheduled) return;
      state.inputLimitRemoverScheduled = true;
      setTimeout(() => {
        state.inputLimitRemoverScheduled = false;
        removeInputLimits();
      }, 80);
    }

    function removeInputLimits() {
      const doc = resolveCurrentDocument();
      const selectors = 'textarea, input[type="text"], input:not([type]), [contenteditable="true"]';
      doc.querySelectorAll(selectors).forEach(unlockInputElement);
      const input = queryInput();
      if (input) unlockInputElement(input);
    }

    function installInputLimitRemover() {
      if (state.inputLimitObserver) return;
      removeInputLimits();
      const doc = resolveCurrentDocument();
      state.inputLimitObserver = new MutationObserver(() => {
        scheduleRemoveInputLimits();
      });
      if (doc.body) {
        state.inputLimitObserver.observe(doc.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['maxlength', 'maxLength', 'data-maxlength', 'data-max-length'],
        });
      }
      doc.addEventListener('focusin', removeInputLimits, true);
    }

    function isLoading() {
      return !!runPollSnapshot().loading;
    }

    function sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function getKeyCodeForChar(char) {
      if (char === '\n') return 'Enter';
      if (char === ' ') return 'Space';
      if (char >= 'a' && char <= 'z') return 'Key' + char.toUpperCase();
      if (char >= 'A' && char <= 'Z') return 'Key' + char;
      if (char >= '0' && char <= '9') return 'Digit' + char;
      return '';
    }

    function moveCaretToEnd(input) {
      if (!input.isContentEditable) {
        if (typeof input.selectionStart === 'number') {
          const len = input.value ? input.value.length : 0;
          input.selectionStart = len;
          input.selectionEnd = len;
        }
        return;
      }
      const sel = window.getSelection();
      if (!sel) return;
      const range = document.createRange();
      range.selectNodeContents(input);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    function clearInputForTyping(input) {
      input.focus();
      input.click();
      if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
        input.select();
        document.execCommand('delete', false);
        return;
      }
      if (input.isContentEditable) {
        const sel = window.getSelection();
        if (!sel) return;
        const range = document.createRange();
        range.selectNodeContents(input);
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('delete', false);
      }
    }

    function insertTextByExec(input, text) {
      input.focus();
      moveCaretToEnd(input);
      return document.execCommand('insertText', false, text);
    }

    function insertTextByPaste(input, text) {
      input.focus();
      moveCaretToEnd(input);
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      const evt = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        composed: true,
        clipboardData: dt,
      });
      return input.dispatchEvent(evt);
    }

    function insertCharByKeyboard(input, char) {
      const key = char === '\n' ? 'Enter' : char;
      const code = getKeyCodeForChar(char);
      const base = {
        key,
        code,
        bubbles: true,
        cancelable: true,
        composed: true,
        repeat: false,
      };

      input.dispatchEvent(new KeyboardEvent('keydown', base));
      if (char.length === 1 && char !== '\n') {
        const charCode = char.charCodeAt(0);
        input.dispatchEvent(
          new KeyboardEvent('keypress', {
            ...base,
            charCode,
            keyCode: charCode,
          })
        );
      }
      input.dispatchEvent(new KeyboardEvent('keyup', base));
    }

    function insertCharByExec(input, char) {
      insertTextByExec(input, char);
    }

    function insertChar(input, char) {
      if (state.typeStrategy === 'exec') {
        insertCharByExec(input, char);
        return;
      }
      insertCharByKeyboard(input, char);
    }

    function readInputText(input) {
      if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
        return input.value || '';
      }
      return input.innerText || input.textContent || '';
    }

    async function typeInput(text) {
      const input = queryInput();
      if (!input) return false;
      input.focus();
      input.click();
      clearInputForTyping(input);

      if (state.typeStrategy === 'paste') {
        insertTextByPaste(input, text);
        if (!readInputText(input).trim()) {
          insertTextByExec(input, text);
        }
        return true;
      }

      if (state.typeStrategy === 'exec') {
        insertTextByExec(input, text);
        return true;
      }

      const delay = state.typeDelayMs || 0;
      for (let i = 0; i < text.length; i++) {
        insertChar(input, text[i]);
        if (delay > 0 && i < text.length - 1) await sleep(delay);
      }
      return true;
    }

    function fillInput(text) {
      const input = queryInput();
      if (!input) return false;
      if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          'value'
        )?.set;
        if (nativeSetter) {
          nativeSetter.call(input, text);
        } else {
          input.value = text;
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (input.isContentEditable) {
        input.textContent = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return true;
    }

    async function appendInputText(addition) {
      const input = queryInput();
      const existing = input ? readInputText(input) : '';
      const text = addition || '';
      if (!existing) {
        return applyInputText(text);
      }
      if (!text) {
        return applyInputText(existing);
      }
      const trimmedEnd = existing.replace(/\s+$/, '');
      const combined = trimmedEnd ? trimmedEnd + '\n\n' + text : text;
      return applyInputText(combined);
    }

    async function applyInputText(text) {
      removeInputLimits();
      if (state.inputMode === 'type') {
        return typeInput(text);
      }
      return fillInput(text);
    }

    function clickSend() {
      const btn = querySendButton();
      if (btn) {
        btn.click();
        return true;
      }
      return clickSendFallback();
    }

    function clickSendFallback() {
      const input = queryInput();
      if (!input) return false;
      const form = input.closest('form');
      if (form && typeof form.requestSubmit === 'function') {
        form.requestSubmit();
        return true;
      }
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
      );
      return true;
    }

    function snapshotTurnKeys(snap) {
      const s = snap && typeof snap === 'object' ? snap : {};
      const userKey =
        s.lastUser && Number.isFinite(Number(s.lastUser.index)) ? Number(s.lastUser.index) : null;
      const agentKey =
        s.lastAgent && Number.isFinite(Number(s.lastAgent.index))
          ? Number(s.lastAgent.index)
          : null;
      return {
        loading: !!s.loading,
        userKey,
        agentKey,
      };
    }

    /** 点击发送后等待 waitBeforeSend（未配置按 300ms），检查 loading/会话 key，未变化则重试，最多 10 次 */
    async function clickSendWithRetry() {
      const configured = Number(state.waitBeforeSend);
      const waitMs = Number.isFinite(configured) && configured > 0 ? configured : 300;
      const before = snapshotTurnKeys(runPollSnapshot());

      for (let attempt = 0; attempt < 10; attempt++) {
        const btn = querySendButton();
        if (btn) {
          btn.click();
        } else {
          clickSendFallback();
        }

        await sleep(waitMs);
        const after = snapshotTurnKeys(runPollSnapshot());
        if (after.loading) return true;
        if (after.userKey !== before.userKey || after.agentKey !== before.agentKey) {
          return true;
        }
      }

      return false;
    }

    function defaultFindCallToolBlocks(root) {
      const scope = root || resolveCurrentDocument();
      const blocks = [];
      const seen = new Set();
      const nodes = scope.querySelectorAll('pre, code, [class*="code-block"], [class*="codeBlock"]');
      for (let i = 0; i < nodes.length; i++) {
        const block = nodes[i];
        if (seen.has(block)) continue;
        seen.add(block);
        const codeText = (block.textContent || '').trim();
        if (codeText.includes('BEGIN_TOOL')) {
          blocks.push(block);
        }
      }
      return blocks;
    }

    function findCallToolBlocks(root) {
      const site = getSite();
      if (site && typeof site.findCallToolBlocks === 'function') {
        try {
          const result = site.findCallToolBlocks(root);
          return Array.isArray(result) ? result : [];
        } catch (err) {
          console.warn('[bridge] findCallToolBlocks failed', err);
          return [];
        }
      }
      return defaultFindCallToolBlocks(root);
    }

    function hasFindCopyButtons() {
      const site = getSite();
      return !!(site && typeof site.findCopyButtons === 'function');
    }

    function findCopyButtons(root) {
      const site = getSite();
      if (!site || typeof site.findCopyButtons !== 'function') return [];
      try {
        const result = site.findCopyButtons(root);
        return Array.isArray(result) ? result : [];
      } catch (err) {
        console.warn('[bridge] findCopyButtons failed', err);
        return [];
      }
    }

    function findToolCodeText(root) {
      const blocks = findCallToolBlocks(root);
      for (let i = blocks.length - 1; i >= 0; i--) {
        const block = blocks[i];
        const codeEl =
          block && block.querySelector ? block.querySelector('code, pre') || block : block;
        const text = ((codeEl && codeEl.textContent) || (block && block.textContent) || '').trim();
        if (text.includes('BEGIN_TOOL')) return text;
      }
      return '';
    }

    function getCallToolBlockRef(block) {
      if (!block || !block.closest) return '';
      const target =
        block.closest('.cosd-markdown, pre, [class*="code-block"], [class*="codeBlock"]') || block;
      if (!target.dataset.agentEditorBlockId) {
        target.dataset.agentEditorBlockId =
          'aeb-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      }
      return target.dataset.agentEditorBlockId;
    }

    function getCopyButtonLabel(btn) {
      if (!btn) return '';
      return (
        (btn.getAttribute('aria-label') || '') +
        (btn.getAttribute('title') || '') +
        (btn.textContent || '') +
        (btn.className || '')
      )
        .trim()
        .slice(0, 80);
    }

    function postBridgeCommLog(direction, content) {
      if (!state.agentId || !content) return;
      state.pendingCommLogs.push({ direction, content });
    }

    function drainPendingCommLogs() {
      const logs = state.pendingCommLogs.slice();
      state.pendingCommLogs = [];
      return logs;
    }

    function drainPendingChatMessages() {
      const msgs = state.pendingChatMessages.slice();
      state.pendingChatMessages = [];
      return msgs;
    }

    function takePendingResetBaseline() {
      if (!state.pendingResetBaseline) return false;
      state.pendingResetBaseline = false;
      return true;
    }

    function captureConversation() {
      const s = runPollSnapshot();
      const list = [];
      if (s.lastUser) {
        list.push({
          key: s.lastUser.index,
          role: 'user',
          text: s.lastUser.text,
        });
      }
      if (s.lastAgent) {
        list.push({
          key: s.lastAgent.index,
          role: 'agent',
          text: s.lastAgent.text,
        });
      }
      return list;
    }

    function logToolCaptureOnce(captureKey, source, text, extra) {
      const trimmed = String(text || '').trim();
      if (!trimmed.includes('BEGIN_TOOL')) return;
      const logKey = String(captureKey) + ':' + source + ':' + trimmed.length;
      if (state.lastCopyLogKey === logKey) return;
      state.lastCopyLogKey = logKey;
      const extraLine = extra ? extra + '\n' : '';
      postBridgeCommLog(
        'copy',
        `status: captured\nsource: ${source}\n${extraLine}length: ${trimmed.length}\ntext:\n${trimmed}`
      );
    }

    function captureClipboardAfterCopy(button) {
      return new Promise((resolve) => {
        let captured = '';
        const onCopy = (e) => {
          try {
            captured = e.clipboardData?.getData('text/plain') || '';
          } catch (_) {
            captured = '';
          }
        };
        document.addEventListener('copy', onCopy, true);
        try {
          button.click();
        } catch (_) {
          document.removeEventListener('copy', onCopy, true);
          resolve('');
          return;
        }
        window.setTimeout(async () => {
          document.removeEventListener('copy', onCopy, true);
          let text = captured.trim();
          if (!text && navigator.clipboard && navigator.clipboard.readText) {
            try {
              text = (await navigator.clipboard.readText()).trim();
            } catch (_) {
              text = '';
            }
          }
          resolve(text);
        }, 150);
      });
    }

    async function readToolTextViaCopyButtons(buttons) {
      if (!buttons || !buttons.length) return '';
      const last = buttons[buttons.length - 1];
      const ordered = [last];
      for (let i = 0; i < buttons.length; i++) {
        if (buttons[i] !== last) ordered.push(buttons[i]);
      }

      for (let i = 0; i < ordered.length; i++) {
        const btn = ordered[i];
        const btnLabel = getCopyButtonLabel(btn);
        const text = await captureClipboardAfterCopy(btn);
        const ok = text.includes('BEGIN_TOOL');
        if (ok) {
          logToolCaptureOnce('btn:' + i, 'copy', text, `button: ${btnLabel}`);
          return text;
        }
        if (text) {
          const failKey = 'copy-fail:' + i + ':' + text.length;
          if (state.lastCopyLogKey !== failKey) {
            state.lastCopyLogKey = failKey;
            postBridgeCommLog(
              'copy',
              `status: failed\nsource: copy\nbutton: ${btnLabel}\nlength: ${text.length}\npreview: ${text.slice(0, 200)}`
            );
          }
        } else {
          const failKey = 'copy-fail:' + i + ':0';
          if (state.lastCopyLogKey !== failKey) {
            state.lastCopyLogKey = failKey;
            postBridgeCommLog(
              'copy',
              `status: failed\nsource: copy\nbutton: ${btnLabel}\nlength: 0`
            );
          }
        }
      }
      return '';
    }

    function getCopiedToolTextIfFresh() {
      if (!state.copiedToolText) return '';
      if (!state.copiedToolText.includes('BEGIN_TOOL')) return '';
      if (Date.now() - state.copiedToolAt > 60000) return '';
      return state.copiedToolText;
    }

    function pinToolTextIfValid(text) {
      const trimmed = String(text || '').trim();
      if (!trimmed.includes('BEGIN_TOOL')) return;
      state.pinnedToolText = trimmed;
      state.pinnedToolAt = Date.now();
    }

    function getPinnedToolTextIfFresh() {
      if (!state.pinnedToolText || !state.pinnedToolText.includes('BEGIN_TOOL')) return '';
      if (Date.now() - state.pinnedToolAt > 120000) return '';
      return state.pinnedToolText;
    }

    function scheduleToolCopyRead() {
      if (state.copyReadInFlight) return;
      if (getCopiedToolTextIfFresh()) return;

      const snap = runPollSnapshot();
      if (snap.loading) return;
      const root = snap.responseRoot || resolveCurrentDocument();

      // DOM 路径：有 findCallToolBlocks 即可，不依赖复制按钮
      const domTool = findToolCodeText(root);
      if (domTool.includes('BEGIN_TOOL')) {
        pinToolTextIfValid(domTool);
        logToolCaptureOnce('dom:' + domTool.length, 'dom', domTool, '');
        return;
      }

      if (!hasFindCopyButtons()) return;

      const buttons = findCopyButtons(root);
      if (!buttons.length) return;

      const blockRef =
        (buttons[buttons.length - 1] && getCallToolBlockRef(buttons[buttons.length - 1])) ||
        'copy-btns:' + buttons.length;
      if (blockRef && blockRef === state.copyReadBlockRef) return;
      const failCount = state.copyReadFailCounts[blockRef] || 0;
      if (failCount >= 5) return;

      state.copyReadInFlight = true;
      readToolTextViaCopyButtons(buttons)
        .then((text) => {
          if (text && text.includes('BEGIN_TOOL')) {
            state.copiedToolText = text;
            state.copiedToolAt = Date.now();
            pinToolTextIfValid(text);
            if (blockRef) {
              state.copyReadBlockRef = blockRef;
              delete state.copyReadFailCounts[blockRef];
            }
          } else if (blockRef) {
            state.copyReadFailCounts[blockRef] = failCount + 1;
          }
        })
        .finally(() => {
          state.copyReadInFlight = false;
        });
    }

    function getCopyToolDebug() {
      const snap = runPollSnapshot();
      const root = snap.responseRoot || resolveCurrentDocument();
      const blocks = findCallToolBlocks(root);
      const buttons = hasFindCopyButtons() ? findCopyButtons(root) : [];
      const btn = buttons.length ? buttons[buttons.length - 1] : null;
      const copied = getCopiedToolTextIfFresh();
      return {
        copyPathEnabled: hasFindCopyButtons(),
        blockCount: blocks.length,
        copyButtonCount: buttons.length,
        hasCopyBtn: !!btn,
        copyBtnLabel: btn
          ? (
              (btn.getAttribute('aria-label') || '') +
              (btn.getAttribute('title') || '') +
              (btn.textContent || '')
            )
              .trim()
              .slice(0, 60)
          : '',
        copiedToolLen: copied ? copied.length : state.copiedToolText ? state.copiedToolText.length : 0,
        copiedToolPreview: copied ? copied.slice(0, 120) : '',
        viaCopy: !!copied,
        pinnedToolLen: getPinnedToolTextIfFresh().length,
        loading: !!snap.loading,
      };
    }

    function getLatestResponseMeta() {
      const s = runPollSnapshot();
      const key = s.lastAgent ? Number(s.lastAgent.index) : -1;
      let text = s.lastAgent ? String(s.lastAgent.text || '') : '';

      // Prefer clipboard/pin when copy path captured BEGIN_TOOL
      const copied = getCopiedToolTextIfFresh();
      if (copied) {
        text = copied;
      } else {
        const pinned = getPinnedToolTextIfFresh();
        if (pinned && (!text || !text.includes('BEGIN_TOOL'))) {
          text = pinned;
        }
      }

      return {
        key: Number.isFinite(key) ? key : -1,
        text,
        loading: !!s.loading,
      };
    }

    function getLatestResponse() {
      return getLatestResponseMeta().text;
    }

    function getFileLineLimit() {
      return {
        read: state.readFileLineLimit || 0,
        write: state.writeFileLineLimit || 0,
      };
    }

    function postChatMessage(agentId, role, text, key) {
      if (!agentId || !text) return;
      state.pendingChatMessages.push({
        agentId,
        role,
        key: key ?? Date.now(),
        text,
      });
    }

    function resetBridgeTracking(agentId) {
      if (!agentId) return;
      state.pendingResetBaseline = true;
    }

    /** getComposer.input 就绪后可选执行 newChatSession，再通知 Host 注入 Agent 模式 */
    function markNewChatOnloadAgentMode() {
      state.pendingNewChatOnloadAgentMode = true;
    }

    function takePendingNewChatOnloadAgentMode() {
      if (!state.pendingNewChatOnloadAgentMode) return false;
      state.pendingNewChatOnloadAgentMode = false;
      return true;
    }

    function getNewChatOnloadDebug() {
      return {
        newChatOnload: !!state.newChatOnload,
        newChatOnloadStarted: !!state.newChatOnloadStarted,
        pendingNewChatOnloadAgentMode: !!state.pendingNewChatOnloadAgentMode,
        hasNewChatSession: !!(getSite() && typeof getSite().newChatSession === 'function'),
      };
    }

    function finishNewChatOnload() {
      const site = getSite();
      function afterSession() {
        // 与新会话按钮相同，稍等片刻再通知 Host
        setTimeout(function () {
          markNewChatOnloadAgentMode();
        }, 500);
      }
      if (site && typeof site.newChatSession === 'function') {
        Promise.resolve()
          .then(function () {
            return site.newChatSession(resolveCurrentDocument());
          })
          .then(afterSession)
          .catch(function (err) {
            console.warn('[bridge] newChatOnload newChatSession failed', err);
          });
        return;
      }
      afterSession();
    }

    function maybeStartNewChatOnload() {
      if (!state.newChatOnload || state.newChatOnloadStarted) return;
      state.newChatOnloadStarted = true;
      const pollMs = 500;
      const maxWaitMs = 120000;
      const startedAt = Date.now();

      function tick() {
        state.newChatOnloadTimer = null;
        try {
          const composer = getComposer(resolveCurrentDocument());
          if (composer && composer.input != null) {
            finishNewChatOnload();
            return;
          }
        } catch (err) {
          console.warn('[bridge] newChatOnload poll failed', err);
        }
        if (Date.now() - startedAt >= maxWaitMs) {
          console.warn('[bridge] newChatOnload timeout waiting for composer input');
          return;
        }
        state.newChatOnloadTimer = setTimeout(tick, pollMs);
      }
      tick();
    }

    /** 启动站点 newChatSession；完成后 pollNewChatSessionStatus 取结果 */
    function startNewChatSession() {
      if (state.newChatStatus === 'running') {
        return { ok: false, error: 'newChatSession already running' };
      }
      const site = getSite();
      if (!site || typeof site.newChatSession !== 'function') {
        return { ok: false, error: 'newChatSession not implemented' };
      }
      state.newChatStatus = 'running';
      Promise.resolve()
        .then(function () {
          return site.newChatSession(resolveCurrentDocument());
        })
        .then(function () {
          state.newChatStatus = { ok: true };
          if (state.agentId) resetBridgeTracking(state.agentId);
        })
        .catch(function (err) {
          state.newChatStatus = {
            ok: false,
            error: String((err && err.message) || err || 'newChatSession failed'),
          };
        });
      return { ok: true };
    }

    function pollNewChatSessionStatus() {
      const s = state.newChatStatus;
      if (s === 'running') return { status: 'running' };
      if (s && typeof s === 'object') {
        state.newChatStatus = null;
        return {
          status: 'done',
          ok: !!s.ok,
          error: s.error ? String(s.error) : '',
        };
      }
      return { status: 'idle' };
    }

    function installSendCapture() {
      if (state.sendCaptureInstalled) return;
      state.sendCaptureInstalled = true;
      const doc = resolveCurrentDocument();
      doc.addEventListener(
        'click',
        (event) => {
          const btn = querySendButton();
          if (!btn) return;
          if (event.target !== btn && !btn.contains(event.target)) return;
          const input = queryInput();
          if (!input) return;
          const text = readInputText(input).trim();
          if (!text || !state.agentId) return;
          postChatMessage(state.agentId, 'user', text, Date.now());
          resetBridgeTracking(state.agentId);
        },
        true
      );
    }

    function postToEditor(_data) {
      // Host polls getLatestResponseMeta / pollSnapshotForHost
    }

    function hasNewResponseText(baseline, text) {
      if (!text) return false;
      if (!baseline) return true;
      if (text === baseline) return false;
      if (text.includes('BEGIN_TOOL') && !baseline.includes('BEGIN_TOOL')) return true;
      return text !== baseline;
    }

    function watchResponse(callback, intervalMs, stableMs) {
      state.responseCallback = callback;
      state.responsePosted = false;
      state.seenChange = false;
      state.lastResponse = '';
      state.stableSince = 0;

      if (state.watchTimer) clearInterval(state.watchTimer);

      const interval = intervalMs || state.pollIntervalMs || 1000;
      const requiredStableMs = stableMs || state.stableMs || 2000;

      state.watchTimer = setInterval(() => {
        const snap = runPollSnapshot();
        if (snap.loading) {
          state.stableSince = 0;
          return;
        }

        scheduleToolCopyRead();

        const meta = getLatestResponseMeta();
        const text = meta.text;
        const key = Number.isFinite(meta.key) ? meta.key : -1;
        if (!text) return;

        if (!state.seenChange) {
          const hasNewKey =
            state.responseBaselineKey >= 0 && key >= 0 && key > state.responseBaselineKey;
          if (hasNewKey) {
            state.seenChange = true;
            state.lastResponse = text;
            state.stableSince = Date.now();
          } else if (!state.responseBaseline) {
            state.seenChange = true;
            state.lastResponse = text;
            state.stableSince = Date.now();
          } else if (hasNewResponseText(state.responseBaseline, text)) {
            state.seenChange = true;
            state.lastResponse = text;
            state.stableSince = Date.now();
          } else {
            return;
          }
        }

        if (text === state.lastResponse) {
          if (Date.now() - state.stableSince >= requiredStableMs && !state.responsePosted) {
            state.responsePosted = true;
            if (state.responseCallback) state.responseCallback(text);
            if (state.watchTimer) {
              clearInterval(state.watchTimer);
              state.watchTimer = null;
            }
          }
        } else {
          state.lastResponse = text;
          state.stableSince = Date.now();
          state.responsePosted = false;
        }
      }, interval);
    }

    async function runSend(msg) {
      state.copiedToolText = '';
      state.copiedToolAt = 0;
      state.copyReadBlockRef = '';
      state.copyReadFailCounts = {};
      state.pinnedToolText = '';
      state.pinnedToolAt = 0;
      state.copyReadInFlight = false;
      state.lastCopyLogKey = '';
      state.pendingCommLogs = [];
      state.pendingChatMessages = [];
      state.pendingResetBaseline = false;

      const baselineMeta = getLatestResponseMeta();
      state.responseBaseline = baselineMeta.text || '';
      state.responseBaselineKey = baselineMeta.key;
      if (msg.text && msg.agentId) {
        postChatMessage(msg.agentId, 'user', msg.text, Date.now());
      }
      if (msg.text) {
        const expected = String(msg.text).trim().length;
        for (let attempt = 0; attempt < 12; attempt++) {
          await applyInputText(msg.text);
          const input = queryInput();
          const current = input ? readInputText(input).trim() : '';
          const need = expected <= 8 ? expected : Math.floor(expected * 0.9);
          if (current && current.length >= need) break;
          await sleep(250);
        }
      }
      await clickSendWithRetry();
      // 等站点自行取稿并清空；立刻 fillInput('') 会打断富文本异步序列化
      for (let i = 0; i < 25; i++) {
        await sleep(120);
        const input = queryInput();
        const current = input ? readInputText(input).trim() : '';
        if (!current) break;
      }
      watchResponse(
        (text) => postToEditor({ type: 'response', text, agentId: msg.agentId }),
        msg.pollIntervalMs || state.pollIntervalMs,
        msg.stableMs || state.stableMs
      );
    }

    function onEditorMessage(msg) {
      if (!msg) return;
      if (msg.type === 'fill') {
        Promise.resolve(appendInputText(msg.text || '')).then(function () {
          var input = queryInput();
          if (input && typeof input.focus === 'function') input.focus();
        });
      } else if (msg.type === 'send') {
        runSend(msg);
      } else if (msg.type === 'clickSend') {
        Promise.resolve(clickSendWithRetry());
      } else if (msg.type === 'newChatSession') {
        startNewChatSession();
      } else if (msg.type === 'config') {
        if (msg.agentId) state.agentId = msg.agentId;
        if (msg.pollIntervalMs) state.pollIntervalMs = msg.pollIntervalMs;
        if (msg.stableMs) state.stableMs = msg.stableMs;
        if (msg.stableCount) state.stableMs = (msg.stableCount || 3) * (msg.pollIntervalMs || 1000);
        if (msg.inputMode === 'type' || msg.inputMode === 'fill') {
          state.inputMode = msg.inputMode;
        }
        if (Number.isFinite(msg.typeDelayMs) && msg.typeDelayMs >= 0) {
          state.typeDelayMs = msg.typeDelayMs;
        }
        if (Number.isFinite(msg.waitBeforeSend) && msg.waitBeforeSend >= 0) {
          state.waitBeforeSend = msg.waitBeforeSend;
        }
        if (typeof msg.newChatOnload === 'boolean') {
          state.newChatOnload = msg.newChatOnload;
        }
        if (Number.isFinite(msg.readFileLineLimit) && msg.readFileLineLimit > 0) {
          state.readFileLineLimit = msg.readFileLineLimit;
        }
        if (Number.isFinite(msg.writeFileLineLimit) && msg.writeFileLineLimit > 0) {
          state.writeFileLineLimit = msg.writeFileLineLimit;
        }
        if (
          msg.typeStrategy === 'keyboard' ||
          msg.typeStrategy === 'exec' ||
          msg.typeStrategy === 'paste'
        ) {
          state.typeStrategy = msg.typeStrategy;
        }
        installSendCapture();
        installInputLimitRemover();
        maybeStartNewChatOnload();
      }
    }

    window[REGISTER_NS] = registerSiteBridge;

    return {
      fillInput,
      appendInputText,
      typeInput,
      clickSend,
      clickSendWithRetry,
      watchResponse,
      postToEditor,
      onEditorMessage,
      getLatestResponse,
      getLatestResponseMeta,
      pollSnapshot: pollSnapshotForHost,
      pollSnapshotForHost,
      isLoading,
      getCopyToolDebug,
      scheduleToolCopyRead,
      drainPendingCommLogs,
      drainPendingChatMessages,
      takePendingResetBaseline,
      startNewChatSession,
      pollNewChatSessionStatus,
      markNewChatOnloadAgentMode,
      takePendingNewChatOnloadAgentMode,
      getNewChatOnloadDebug,
      captureConversation,
      removeInputLimits,
      getFileLineLimit,
      getComposer,
      resolveCurrentDocument,
      get responseBaseline() {
        return state.responseBaseline;
      },
      set responseBaseline(value) {
        state.responseBaseline = value || '';
      },
    };
  }

  window[BRIDGE_NS] = createBridge();

  window.addEventListener('agent-editor-message', function (e) {
    window[BRIDGE_NS].onEditorMessage(e.detail);
  });
})();
