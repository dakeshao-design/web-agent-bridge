/**
 * Agent 桥接默认业务实现
 */
(function () {
  'use strict';

  const BRIDGE_NS = '__agentEditorBridge';

  if (window[BRIDGE_NS]) return;

  function createBridge() {
    const REGISTER_NS = '__agentEditorBridgeRegister';

    const DEFAULT_RESPONSE_SELECTORS =
      '[data-message-author-role="assistant"], [class*="assistant"], [class*="markdown"]';

    const state = {
      lastResponse: '',
      stableSince: 0,
      watchTimer: null,
      responseCallback: null,
      responsePosted: false,
      seenChange: false,
      resolvers: {},
      cssSelectors: {},
      pollIntervalMs: 500,
      stableMs: 2000,
      responseBaseline: '',
      responseBaselineKey: -1,
      customGetResponse: null,
      inputMode: 'fill',
      typeDelayMs: 0,
      typeStrategy: 'keyboard',
      agentId: '',
      sendCaptureInstalled: false,
      inputLimitObserver: null,
      readToolViaCopy: false,
      fileLineLimit: 0,
      copiedToolText: '',
      copiedToolAt: 0,
      copyReadInFlight: false,
      copyReadBlockKey: '',
      copyReadBlockRef: '',
      copyReadFailCounts: {},
      pinnedToolText: '',
      pinnedToolAt: 0,
      lastCopyLogKey: '',
      pendingCommLogs: [],
      pendingChatMessages: [],
      pendingResetBaseline: false,
      siteAdapter: null,
    };

    function isLikelyFunctionSource(source) {
      const text = String(source || '').trim();
      return (
        text.startsWith('(') ||
        text.startsWith('function') ||
        text.includes('=>')
      );
    }

    function compileSelectorFn(source) {
      if (!source || typeof source !== 'string') return null;
      const trimmed = source.trim();
      if (!trimmed || !isLikelyFunctionSource(trimmed)) return null;
      try {
        const fn = (0, eval)('(' + trimmed + ')');
        return typeof fn === 'function' ? fn : null;
      } catch (err) {
        console.warn('[bridge] selector compile failed', err);
        return null;
      }
    }

    function applySelectorConfig(selectors) {
      const config = { ...(selectors || {}) };
      if (Object.keys(config).length === 0) return;

      const getLatestResponseSource = config.getLatestResponse;
      delete config.getLatestResponse;

      if (typeof getLatestResponseSource === 'function') {
        state.customGetResponse = getLatestResponseSource;
      } else if (getLatestResponseSource && typeof getLatestResponseSource === 'string') {
        const fn = compileSelectorFn(getLatestResponseSource);
        if (fn) state.customGetResponse = fn;
      }

      for (const [key, value] of Object.entries(config)) {
        if (typeof value === 'function') {
          state.resolvers[key] = value;
          continue;
        }
        if (!value || typeof value !== 'string') continue;
        const fn = compileSelectorFn(value);
        if (fn) {
          state.resolvers[key] = fn;
        } else {
          state.cssSelectors[key] = value;
        }
      }
    }

    function registerSiteBridge(site) {
      if (!site || typeof site !== 'object') return;
      if (site.adapter && typeof site.adapter === 'object') {
        state.siteAdapter = site.adapter;
      }
      if (site.selectors) {
        applySelectorConfig(site.selectors);
      }
      if (typeof site.fileLineLimit === 'number' && site.fileLineLimit > 0) {
        state.fileLineLimit = site.fileLineLimit;
      }
    }

    function getSiteAdapter() {
      return state.siteAdapter || {};
    }

    function callSite(method, fallback) {
      const fn = getSiteAdapter()[method];
      if (typeof fn === 'function') {
        return fn.apply(getSiteAdapter(), Array.prototype.slice.call(arguments, 2));
      }
      return typeof fallback === 'function' ? fallback.apply(null, Array.prototype.slice.call(arguments, 2)) : fallback;
    }

    function splitSelectors(selectorText) {
      return String(selectorText || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }

    function resolveElement(key, fallbackCss) {
      const fn = state.resolvers[key];
      if (fn) {
        try {
          const result = fn();
          if (result instanceof HTMLElement) return result;
          return null;
        } catch (err) {
          console.warn('[bridge] selector runtime failed:', key, err);
          return null;
        }
      }

      const selectors = splitSelectors(state.cssSelectors[key] || fallbackCss || '');
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) return el;
      }
      return null;
    }

    function queryInput() {
      return resolveElement('input', 'textarea');
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
      const selectors = 'textarea, input[type="text"], input:not([type]), [contenteditable="true"]';
      document.querySelectorAll(selectors).forEach(unlockInputElement);
      const input = queryInput();
      if (input) unlockInputElement(input);
    }

    function installInputLimitRemover() {
      if (state.inputLimitObserver) return;
      removeInputLimits();
      state.inputLimitObserver = new MutationObserver(() => {
        scheduleRemoveInputLimits();
      });
      if (document.body) {
        state.inputLimitObserver.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['maxlength', 'maxLength', 'data-maxlength', 'data-max-length'],
        });
      }
      document.addEventListener('focusin', removeInputLimits, true);
    }

    function querySendButton() {
      return resolveElement('sendButton', "button[type='submit']");
    }

    function isLoading() {
      const fn = state.resolvers.loadingIndicator;
      if (fn) {
        try {
          const result = fn();
          if (typeof result === 'boolean') return result;
          if (result instanceof HTMLElement) return result.offsetParent !== null;
        } catch (err) {
          console.warn('[bridge] loadingIndicator failed', err);
        }
        return false;
      }

      const selectors = splitSelectors(state.cssSelectors.loadingIndicator || '');
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) return true;
      }
      return false;
    }

    function queryResponseContainer() {
      const direct = resolveElement('responseContainer');
      if (direct) {
        const text = (direct.innerText || direct.textContent || '').trim();
        if (text) return direct;
      }

      const selectors = splitSelectors(
        state.cssSelectors.responseContainer || DEFAULT_RESPONSE_SELECTORS
      );
      for (const sel of selectors) {
        const nodes = document.querySelectorAll(sel);
        if (nodes.length === 0) continue;
        const last = nodes[nodes.length - 1];
        const text = (last.innerText || last.textContent || '').trim();
        if (text) return last;
      }
      return null;
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

    function defaultResolveToolBlockRoot(block) {
      if (!block) return block;
      let node = block;
      for (let depth = 0; depth < 5 && node; depth++) {
        const hasCopy = node.querySelector(
          '[class*="copy"], [aria-label*="复制"], [aria-label*="copy"], [title*="复制"], [title*="copy"]'
        );
        if (hasCopy) return node;
        node = node.parentElement;
      }
      return block;
    }

    function defaultFindCallToolBlocks(root) {
      const scope = root || document;
      const blocks = [];
      const seen = new Set();
      const nodes = scope.querySelectorAll('pre, [class*="code-block"], [class*="codeBlock"]');
      for (let i = 0; i < nodes.length; i++) {
        const block = nodes[i];
        if (seen.has(block)) continue;
        seen.add(block);
        const codeEl = block.querySelector('code, pre') || block;
        const codeText = (codeEl.textContent || '').trim();
        if (codeText.includes('BEGIN_TOOL')) {
          blocks.push(callSite('resolveToolBlockRoot', defaultResolveToolBlockRoot, block));
        }
      }
      return blocks;
    }

    function defaultFindCopyButtonInBlock(block) {
      const root = callSite('resolveToolBlockRoot', defaultResolveToolBlockRoot, block);
      const scopes = root === block ? [block] : [root, block];
      for (let s = 0; s < scopes.length; s++) {
        const scope = scopes[s];
        const candidates = scope.querySelectorAll(
          '[role="button"], button, a, span, div, [class*="copy"], [aria-label*="复制"], [aria-label*="copy"], [title*="复制"], [title*="copy"]'
        );
        for (let i = 0; i < candidates.length; i++) {
          const el = candidates[i];
          const rect = el.getBoundingClientRect();
          if (rect.width <= 0 && rect.height <= 0 && el.offsetParent === null) continue;
          const label = (
            (el.getAttribute('aria-label') || '') +
            (el.getAttribute('title') || '') +
            (el.textContent || '') +
            (el.className || '')
          ).trim();
          if (/^(复制|copy)$/i.test(label) || /\b(复制|copy)\b/i.test(label) || /copy/i.test(String(el.className || ''))) {
            return el;
          }
        }
      }
      return null;
    }

    function defaultFindToolCodeText(root) {
      if (!root) return '';
      const codes = root.querySelectorAll('pre code, code');
      for (let i = codes.length - 1; i >= 0; i--) {
        const text = (codes[i].textContent || '').trim();
        if (text.includes('BEGIN_TOOL')) return text;
      }
      return '';
    }

    function resolveToolBlockRoot(block) {
      return callSite('resolveToolBlockRoot', defaultResolveToolBlockRoot, block);
    }

    function findCallToolBlocks(root) {
      return callSite('findCallToolBlocks', defaultFindCallToolBlocks, root);
    }

    function findCopyButtonInBlock(block) {
      return callSite('findCopyButtonInBlock', defaultFindCopyButtonInBlock, block);
    }

    function findToolCodeText(root) {
      return callSite('findToolCodeText', defaultFindToolCodeText, root);
    }

    function getCallToolBlockKey(block) {
      const codeEl = block.querySelector('code, pre');
      return (codeEl ? codeEl.textContent : block.textContent || '').trim().slice(0, 240);
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

    /** 站点 adapter.captureConversation 可选；无则空，由 Rust 轮询 bridge 回复 */
    function captureConversation() {
      if (state.siteAdapter && typeof state.siteAdapter.captureConversation === 'function') {
        try {
          const list = state.siteAdapter.captureConversation();
          return Array.isArray(list) ? list : [];
        } catch (_) {
          return [];
        }
      }
      return [];
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

    function findCallToolBlocksWithFallback(root) {
      const scope = root || document;
      let blocks = findCallToolBlocks(scope);
      if (!blocks.length && scope !== document) {
        blocks = findCallToolBlocks(document);
      }
      return blocks;
    }

    async function readLatestToolTextViaCopy(root) {
      const blocks = findCallToolBlocksWithFallback(root);
      if (!blocks.length) return '';
      const block = blocks[blocks.length - 1];
      const btn = findCopyButtonInBlock(block);
      if (!btn) return '';
      const blockKey = getCallToolBlockKey(block);
      const btnLabel = getCopyButtonLabel(btn);
      const text = await captureClipboardAfterCopy(btn);
      const ok = text.includes('BEGIN_TOOL');
      if (ok) {
        logToolCaptureOnce(blockKey, 'copy', text, `button: ${btnLabel}`);
      } else if (text) {
        const failKey = blockKey + ':copy-fail:' + text.length;
        if (state.lastCopyLogKey !== failKey) {
          state.lastCopyLogKey = failKey;
          postBridgeCommLog(
            'copy',
            `status: failed\nsource: copy\nbutton: ${btnLabel}\nlength: ${text.length}\npreview: ${text.slice(0, 200)}`
          );
        }
      } else {
        const failKey = blockKey + ':copy-fail:0';
        if (state.lastCopyLogKey !== failKey) {
          state.lastCopyLogKey = failKey;
          postBridgeCommLog(
            'copy',
            `status: failed\nsource: copy\nbutton: ${btnLabel}\nlength: 0`
          );
        }
      }
      return ok ? text : '';
    }

    function getCopiedToolTextIfFresh() {
      if (!state.readToolViaCopy || !state.copiedToolText) return '';
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
      if (!state.readToolViaCopy || state.copyReadInFlight) return;
      if (getCopiedToolTextIfFresh()) return;

      const container = queryResponseContainer();
      const domTool = findToolCodeText(container || document);
      if (domTool.includes('BEGIN_TOOL')) {
        pinToolTextIfValid(domTool);
        logToolCaptureOnce('dom:' + domTool.length, 'dom', domTool, '');
        return;
      }

      const blocks = findCallToolBlocksWithFallback(container);
      if (!blocks.length) return;
      const block = blocks[blocks.length - 1];
      const blockRef = getCallToolBlockRef(block) || '';
      if (blockRef && blockRef === state.copyReadBlockRef) return;
      const failCount = state.copyReadFailCounts[blockRef] || 0;
      if (failCount >= 5) return;

      const btn = findCopyButtonInBlock(block);
      if (!btn) return;

      state.copyReadInFlight = true;
      readLatestToolTextViaCopy(container)
        .then((text) => {
          if (text && text.includes('BEGIN_TOOL')) {
            state.copiedToolText = text;
            state.copiedToolAt = Date.now();
            state.copyReadBlockKey = getCallToolBlockKey(block);
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

    function pickToolText(container) {
      const copied = getCopiedToolTextIfFresh();
      if (copied) {
        pinToolTextIfValid(copied);
        return copied;
      }
      const dom = findToolCodeText(container || document);
      if (dom.includes('BEGIN_TOOL')) {
        pinToolTextIfValid(dom);
        return dom;
      }
      return getPinnedToolTextIfFresh();
    }

    function getCopyToolDebug() {
      const container = queryResponseContainer();
      const blocks = findCallToolBlocksWithFallback(container);
      const block = blocks.length ? blocks[blocks.length - 1] : null;
      const btn = block ? findCopyButtonInBlock(block) : null;
      const copied = getCopiedToolTextIfFresh();
      const base = {
        readToolViaCopy: state.readToolViaCopy,
        blockCount: blocks.length,
        hasCopyBtn: !!btn,
        copyBtnLabel: btn
          ? ((btn.getAttribute('aria-label') || '') + (btn.getAttribute('title') || '') + (btn.textContent || '')).trim().slice(0, 60)
          : '',
        copiedToolLen: copied ? copied.length : state.copiedToolText ? state.copiedToolText.length : 0,
        copiedToolPreview: copied ? copied.slice(0, 120) : '',
        viaCopy: !!copied,
        pinnedToolLen: getPinnedToolTextIfFresh().length,
      };
      const extra = callSite('getCopyDebugExtra', null, block, btn);
      return extra && typeof extra === 'object' ? { ...base, ...extra } : base;
    }

    function withLoading(meta) {
      const base = meta && typeof meta === 'object' ? meta : { key: -1, text: '' };
      return {
        key: Number.isFinite(base.key) ? base.key : -1,
        text: String(base.text || ''),
        loading: isLoading(),
      };
    }

    function getLatestResponseMeta() {
      const copied = getCopiedToolTextIfFresh();
      if (copied) return withLoading({ key: -1, text: copied });

      const siteMeta = callSite('getLatestResponseMeta', null);
      if (siteMeta && typeof siteMeta === 'object' && siteMeta.text) {
        if (siteMeta.text.includes('BEGIN_TOOL')) {
          pinToolTextIfValid(siteMeta.text);
          return withLoading(siteMeta);
        }
        const toolText = pickToolText(queryResponseContainer());
        if (toolText) return withLoading({ key: -1, text: toolText });
        const pinned = getPinnedToolTextIfFresh();
        if (pinned) return withLoading({ key: -1, text: pinned });
        return withLoading(siteMeta);
      }

      if (typeof state.customGetResponse === 'function') {
        const result = state.customGetResponse();
        if (typeof result === 'string') {
          const text = result.trim();
          if (text.includes('BEGIN_TOOL')) return withLoading({ key: -1, text });
        }
        if (result && typeof result === 'object') {
          const text = String(result.text || '').trim();
          const key = Number.isFinite(result.key) ? result.key : -1;
          if (text.includes('BEGIN_TOOL')) return withLoading({ key, text });
          const toolText = pickToolText(queryResponseContainer());
          if (toolText) return withLoading({ key: -1, text: toolText });
          if (text) return withLoading({ key, text });
        }
      }

      const container = queryResponseContainer();
      if (!container) return withLoading({ key: -1, text: '' });
      const toolText = pickToolText(container);
      if (toolText) return withLoading({ key: -1, text: toolText });
      const pinned = getPinnedToolTextIfFresh();
      if (pinned) return withLoading({ key: -1, text: pinned });
      return withLoading({
        key: -1,
        text: (container.innerText || container.textContent || '').trim(),
      });
    }

    function getLatestResponse() {
      return getLatestResponseMeta().text;
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

    function installSendCapture() {
      if (state.sendCaptureInstalled) return;
      state.sendCaptureInstalled = true;
      document.addEventListener(
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
      // 远端页不 invoke；由 Rust 轮询 getLatestResponseMeta 定稿
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

      const interval = intervalMs || state.pollIntervalMs || 500;
      const requiredStableMs = stableMs || state.stableMs || 2000;

      state.watchTimer = setInterval(() => {
        if (isLoading()) {
          state.stableSince = 0;
          return;
        }

        scheduleToolCopyRead();

        const meta = getLatestResponseMeta();
        const text = meta.text;
        if (!text) return;

        if (!state.seenChange) {
          const hasNewKey =
            state.responseBaselineKey >= 0 &&
            meta.key >= 0 &&
            meta.key > state.responseBaselineKey;
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
      state.copyReadBlockKey = '';
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
        // 基线由 Rust send_agent_message 侧 reset；页面点击发送走 pendingResetBaseline
      }
      if (msg.text) {
        for (let attempt = 0; attempt < 12; attempt++) {
          await applyInputText(msg.text);
          const input = queryInput();
          const current = input ? readInputText(input).trim() : '';
          if (current && current.length >= Math.min(msg.text.length, 8)) break;
          await sleep(250);
        }
      }
      clickSend();
      // 发送后清空，避免工具结果残留在输入框
      fillInput('');
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
      } else if (msg.type === 'config') {
        if (msg.agentId) state.agentId = msg.agentId;
        if (msg.selectors) applySelectorConfig(msg.selectors);
        if (msg.pollIntervalMs) state.pollIntervalMs = msg.pollIntervalMs;
        if (msg.stableMs) state.stableMs = msg.stableMs;
        if (msg.stableCount) state.stableMs = (msg.stableCount || 3) * (msg.pollIntervalMs || 500);
        if (msg.inputMode === 'type' || msg.inputMode === 'fill') {
          state.inputMode = msg.inputMode;
        }
        if (Number.isFinite(msg.typeDelayMs) && msg.typeDelayMs >= 0) {
          state.typeDelayMs = msg.typeDelayMs;
        }
        if (msg.typeStrategy === 'keyboard' || msg.typeStrategy === 'exec' || msg.typeStrategy === 'paste') {
          state.typeStrategy = msg.typeStrategy;
        }
        if (typeof msg.readToolViaCopy === 'boolean') {
          state.readToolViaCopy = msg.readToolViaCopy;
        }
        if (typeof msg.getLatestResponse === 'function') {
          state.customGetResponse = msg.getLatestResponse;
        }
        installSendCapture();
        installInputLimitRemover();
      }
    }

    window[REGISTER_NS] = registerSiteBridge;

    return {
      fillInput,
      appendInputText,
      typeInput,
      clickSend,
      watchResponse,
      postToEditor,
      onEditorMessage,
      getLatestResponse,
      getLatestResponseMeta,
      isLoading,
      getCopyToolDebug,
      scheduleToolCopyRead,
      drainPendingCommLogs,
      drainPendingChatMessages,
      takePendingResetBaseline,
      captureConversation,
      removeInputLimits,
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
