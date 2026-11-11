(function () {
  const vscode = acquireVsCodeApi();
  const tabsEl = document.getElementById('tabs');
  const chatEl = document.getElementById('chat');
  const logsEl = document.getElementById('logs');
  const inputEl = document.getElementById('input');
  const hostStatusEl = document.getElementById('hostStatus');
  const debugToolsBtn = document.getElementById('debugToolsBtn');
  const debugMenu = document.getElementById('debugMenu');
  const debugOverlay = document.getElementById('debugOverlay');
  const debugDialogTitle = document.getElementById('debugDialogTitle');
  const debugDialogBody = document.getElementById('debugDialogBody');
  const debugDialogPrimary = document.getElementById('debugDialogPrimary');
  const debugDialogClose = document.getElementById('debugDialogClose');
  const debugDialogCloseX = document.getElementById('debugDialogCloseX');
  const configBtn = document.getElementById('configBtn');
  const configOverlay = document.getElementById('configOverlay');
  const configDialogBody = document.getElementById('configDialogBody');
  const configDialogClose = document.getElementById('configDialogClose');
  const configDialogCloseX = document.getElementById('configDialogCloseX');
  const configSaveBtn = document.getElementById('configSaveBtn');
  const planBtn = document.getElementById('planBtn');
  const planOverlay = document.getElementById('planOverlay');
  const planContent = document.getElementById('planContent');
  const planError = document.getElementById('planError');
  const planCreateBtn = document.getElementById('planCreateBtn');
  const planDialogClose = document.getElementById('planDialogClose');
  const planDialogCloseX = document.getElementById('planDialogCloseX');
  const composerActions = document.getElementById('composerActions');
  const composerActionsItems = document.getElementById('composerActionsItems');
  const moreBtn = document.getElementById('moreBtn');
  const moreMenu = document.getElementById('moreMenu');
  let lastSnapshot = null;
  let debugDialogKind = null;
  let planSubmitting = false;
  let toolbarOverflowTimer = null;

  if (typeof marked !== 'undefined') {
    marked.setOptions({
      gfm: true,
      breaks: true,
    });
  }

  function post(type, payload) {
    vscode.postMessage(Object.assign({ type: type }, payload || {}));
  }

  /** 简易消毒：去掉脚本与事件属性 */
  function sanitizeHtml(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const walk = function (node) {
      if (node.nodeType !== 1) return;
      const el = node;
      const tag = el.tagName.toLowerCase();
      if (tag === 'script' || tag === 'iframe' || tag === 'object' || tag === 'embed' || tag === 'link') {
        el.remove();
        return;
      }
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on') || name === 'srcdoc' || (name === 'href' && /^\s*javascript:/i.test(attr.value))) {
          el.removeAttribute(attr.name);
        }
      }
      Array.from(el.childNodes).forEach(walk);
    };
    Array.from(template.content.childNodes).forEach(walk);
    return template.innerHTML;
  }

  function renderMarkdown(text) {
    const raw = String(text || '');
    if (!raw) return '';
    if (typeof marked === 'undefined') {
      const pre = document.createElement('pre');
      pre.textContent = raw;
      return pre.outerHTML;
    }
    try {
      const html = marked.parse(raw);
      return sanitizeHtml(typeof html === 'string' ? html : String(html));
    } catch {
      const pre = document.createElement('pre');
      pre.textContent = raw;
      return pre.outerHTML;
    }
  }

  /** 收集当前已展开 call-tool 的 raw 作为稳定 key */
  function getOpenCallToolKeys() {
    const keys = new Set();
    chatEl.querySelectorAll('details.call-tool-fold[open]').forEach(function (el) {
      const rawEl = el.querySelector('.call-tool-raw');
      if (rawEl) keys.add(rawEl.textContent || '');
    });
    return keys;
  }

  /** 渲染含可折叠 call-tool 的片段 */
  function renderDisplayParts(container, parts, openKeys) {
    parts.forEach(function (part) {
      if (!part || part.kind === 'text') {
        const wrap = document.createElement('div');
        wrap.className = 'md-part';
        wrap.innerHTML = renderMarkdown(part && part.text ? part.text : '');
        container.appendChild(wrap);
        return;
      }
      if (part.kind !== 'tool') return;
      const details = document.createElement('details');
      details.className = 'call-tool-fold';
      if (part.status) details.dataset.status = part.status;
      if (openKeys && openKeys.has(part.raw || '')) details.open = true;
      const summary = document.createElement('summary');
      summary.className = 'call-tool-summary';
      summary.textContent = part.summary || 'call-tool';
      const pre = document.createElement('pre');
      pre.className = 'call-tool-raw';
      pre.textContent = part.raw || '';
      details.appendChild(summary);
      details.appendChild(pre);
      if (part.result) {
        const resultPre = document.createElement('pre');
        resultPre.className = 'call-tool-result';
        resultPre.textContent = part.result;
        details.appendChild(resultPre);
      }
      container.appendChild(details);
    });
  }

  function setDebugMenuOpen(open) {
    if (!debugMenu) return;
    if (open) debugMenu.classList.remove('hidden');
    else debugMenu.classList.add('hidden');
  }

  function setMoreMenuOpen(open) {
    if (!moreMenu || !moreBtn) return;
    if (open) {
      moreMenu.classList.remove('hidden');
      moreBtn.setAttribute('aria-expanded', 'true');
    } else {
      moreMenu.classList.add('hidden');
      moreBtn.setAttribute('aria-expanded', 'false');
    }
  }

  function isDebugMenuOpen() {
    return !!(debugMenu && !debugMenu.classList.contains('hidden'));
  }

  function isMoreMenuOpen() {
    return !!(moreMenu && !moreMenu.classList.contains('hidden'));
  }

  /** 宽度不足时把右侧按钮收入 ... 菜单，发送始终固定在最右 */
  function updateToolbarOverflow() {
    if (!composerActions || !composerActionsItems || !moreBtn || !moreMenu) return;
    // 弹出菜单打开时跳过，避免菜单引起的宽度抖动把调试工具收进 ...
    if (isDebugMenuOpen() || isMoreMenuOpen()) return;

    const items = Array.from(composerActionsItems.querySelectorAll(':scope > [data-toolbar-item]')).concat(
      Array.from(moreMenu.querySelectorAll(':scope > [data-toolbar-item]'))
    );
    if (!items.length) return;

    items.forEach(function (el) {
      if (el.parentElement !== composerActionsItems) composerActionsItems.appendChild(el);
    });
    moreBtn.classList.add('hidden');

    const gap = 4;
    const sendBtn = document.getElementById('sendBtn');
    const sendWidth = sendBtn ? sendBtn.offsetWidth : 0;
    const totalWidth = composerActions.clientWidth;
    let available = Math.max(0, totalWidth - sendWidth - (sendWidth ? gap : 0));

    const widths = items.map(function (el) {
      return el.offsetWidth;
    });

    function countFit(avail) {
      let used = 0;
      let fit = 0;
      for (let i = 0; i < items.length; i++) {
        const w = widths[i] + (fit > 0 ? gap : 0);
        if (used + w > avail) break;
        used += w;
        fit += 1;
      }
      return fit;
    }

    let fitCount = countFit(available);
    if (fitCount < items.length) {
      moreBtn.classList.remove('hidden');
      const moreWidth = moreBtn.offsetWidth;
      available = Math.max(0, totalWidth - sendWidth - moreWidth - gap * (sendWidth ? 2 : 1));
      fitCount = countFit(available);
    }

    for (let i = fitCount; i < items.length; i++) {
      moreMenu.appendChild(items[i]);
    }

    if (fitCount >= items.length) moreBtn.classList.add('hidden');
  }

  function scheduleToolbarOverflow() {
    if (toolbarOverflowTimer) clearTimeout(toolbarOverflowTimer);
    toolbarOverflowTimer = setTimeout(function () {
      toolbarOverflowTimer = null;
      updateToolbarOverflow();
    }, 50);
  }

  function closeDebugDialog() {
    debugDialogKind = null;
    if (debugOverlay) debugOverlay.classList.add('hidden');
  }

  function closePlanDialog() {
    if (planSubmitting) return;
    planOverlay.classList.add('hidden');
    planContent.value = '';
    planError.textContent = '';
    updatePlanCreateButton();
  }

  function updatePlanCreateButton() {
    planContent.disabled = planSubmitting;
    planDialogClose.disabled = planSubmitting;
    planDialogCloseX.disabled = planSubmitting;
    planCreateBtn.disabled =
      planSubmitting ||
      !planContent.value.trim() ||
      !lastSnapshot ||
      !lastSnapshot.activeAgentId ||
      !lastSnapshot.workspaceRoot;
    planCreateBtn.textContent = planSubmitting ? '创建中…' : '创建计划';
  }

  function openPlanDialog() {
    planError.textContent = '';
    planOverlay.classList.remove('hidden');
    updatePlanCreateButton();
    planContent.focus();
  }

  function openDebugDialog(kind, title, body) {
    debugDialogKind = kind;
    if (debugDialogTitle) debugDialogTitle.textContent = title || '';
    if (debugDialogBody) debugDialogBody.textContent = body || '(空)';
    if (debugDialogPrimary) {
      debugDialogPrimary.textContent = kind === 'lastCallTool' ? 'execute' : 'Send';
      debugDialogPrimary.disabled = kind === 'lastCallTool' && body === '(无 call-tool)';
    }
    if (debugOverlay) debugOverlay.classList.remove('hidden');
  }

  function isConfigDialogOpen() {
    return !!(configOverlay && !configOverlay.classList.contains('hidden'));
  }

  function closeConfigDialog() {
    if (configOverlay) configOverlay.classList.add('hidden');
  }

  function openConfigDialog() {
    if (!lastSnapshot) return;
    renderPermissions(lastSnapshot);
    if (configOverlay) configOverlay.classList.remove('hidden');
  }

  if (planBtn) planBtn.addEventListener('click', openPlanDialog);
  if (planDialogClose) planDialogClose.addEventListener('click', closePlanDialog);
  if (planDialogCloseX) planDialogCloseX.addEventListener('click', closePlanDialog);
  if (planContent) {
    planContent.addEventListener('input', updatePlanCreateButton);
  }
  if (planCreateBtn) {
    planCreateBtn.addEventListener('click', function () {
      const description = planContent.value.trim();
      if (!description || planSubmitting) return;
      planSubmitting = true;
      planError.textContent = '';
      updatePlanCreateButton();
      post('createPlan', { description: description });
    });
  }

  if (configBtn) configBtn.addEventListener('click', openConfigDialog);
  if (configDialogClose) configDialogClose.addEventListener('click', closeConfigDialog);
  if (configDialogCloseX) configDialogCloseX.addEventListener('click', closeConfigDialog);
  if (configSaveBtn) {
    configSaveBtn.addEventListener('click', function () {
      if (!lastSnapshot) return;
      post('saveToolPermissions', { permissions: lastSnapshot.toolPermissions || {} });
    });
  }

  document.querySelectorAll('[data-cmd]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      post(btn.getAttribute('data-cmd'));
    });
  });

  if (debugToolsBtn) {
    debugToolsBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      const open = debugMenu && debugMenu.classList.contains('hidden');
      setDebugMenuOpen(!!open);
    });
  }

  if (debugMenu) {
    debugMenu.querySelectorAll('[data-debug]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const action = btn.getAttribute('data-debug');
        setDebugMenuOpen(false);
        setMoreMenuOpen(false);
        if (action === 'agentModePrompt') post('getAgentModePrompt');
        else if (action === 'lastCallTool') post('getLastCallTool');
        else if (action === 'stopTerminal') post('killTerminal');
      });
    });
  }

  if (moreBtn) {
    moreBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      const open = moreMenu && moreMenu.classList.contains('hidden');
      setDebugMenuOpen(false);
      setMoreMenuOpen(!!open);
    });
  }

  if (moreMenu) {
    moreMenu.addEventListener('click', function (e) {
      e.stopPropagation();
      const target = e.target;
      if (!(target instanceof Element)) return;
      // 收入菜单的普通按钮点击后关闭；调试工具保留子菜单
      if (target.closest('#debugToolsBtn')) return;
      if (target.closest('[data-debug]')) return;
      if (target.closest('[data-toolbar-item]')) setMoreMenuOpen(false);
    });
  }

  document.addEventListener('click', function () {
    const wasOpen = isDebugMenuOpen() || isMoreMenuOpen();
    setDebugMenuOpen(false);
    setMoreMenuOpen(false);
    if (wasOpen) scheduleToolbarOverflow();
  });

  if (composerActions && typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(function () {
      scheduleToolbarOverflow();
    });
    ro.observe(composerActions);
  } else {
    window.addEventListener('resize', scheduleToolbarOverflow);
  }
  scheduleToolbarOverflow();

  if (debugDialogClose) {
    debugDialogClose.addEventListener('click', closeDebugDialog);
  }
  if (debugDialogCloseX) {
    debugDialogCloseX.addEventListener('click', closeDebugDialog);
  }
  if (debugDialogPrimary) {
    debugDialogPrimary.addEventListener('click', function () {
      if (!debugDialogKind) return;
      const kind = debugDialogKind;
      debugDialogKind = null;
      if (debugOverlay) debugOverlay.classList.add('hidden');
      if (kind === 'agentMode') post('sendAgentModePrompt');
      else post('executeLastCallTool');
    });
  }

  document.getElementById('sendBtn').addEventListener('click', function () {
    const sendBtn = document.getElementById('sendBtn');
    if (sendBtn.disabled) return;
    if (sendBtn.dataset.mode === 'stop') {
      post('stop');
      return;
    }
    const text = inputEl.value;
    if (!text.trim()) return;
    post('send', { text: text });
    inputEl.value = '';
  });

  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const sendBtn = document.getElementById('sendBtn');
      if (sendBtn.disabled || sendBtn.dataset.mode === 'stop') return;
      sendBtn.click();
    }
  });

  function renderPermissions(snapshot) {
    if (!configDialogBody) return;
    configDialogBody.innerHTML = '';

    const hint = document.createElement('div');
    hint.className = 'perm-hint';
    hint.textContent = '允许 / 询问 / 禁止';
    configDialogBody.appendChild(hint);

    const perms = snapshot.toolPermissions || {};
    const tools = snapshot.toolsForSettings || [];
    tools.forEach(function (tool) {
      const row = document.createElement('div');
      row.className = 'perm-row';

      const name = document.createElement('div');
      name.className = 'perm-name';
      name.textContent = tool.label || tool.name;

      const desc = document.createElement('div');
      desc.className = 'perm-desc';
      desc.textContent = tool.description || '';

      const modes = document.createElement('div');
      modes.className = 'perm-modes';
      const current =
        perms[tool.name] || (tool.name === 'outside_workspace' ? 'ask' : 'allow');
      ['allow', 'ask', 'deny'].forEach(function (mode) {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'perm-' + tool.name;
        input.checked = current === mode;
        input.addEventListener('change', function () {
          if (!input.checked) return;
          post('setToolPermission', { toolName: tool.name, mode: mode });
        });
        label.appendChild(input);
        label.appendChild(
          document.createTextNode(mode === 'allow' ? '允许' : mode === 'ask' ? '询问' : '禁止')
        );
        modes.appendChild(label);
      });

      row.appendChild(name);
      row.appendChild(desc);
      row.appendChild(modes);
      configDialogBody.appendChild(row);
    });
  }

  function render(snapshot) {
    lastSnapshot = snapshot;
    hostStatusEl.textContent = snapshot.hostReady
      ? 'Agent Host: 已连接'
      : 'Agent Host: 未连接（发送时将尝试启动）';

    tabsEl.innerHTML = '';
    (snapshot.agents || []).forEach(function (agent) {
      const btn = document.createElement('button');
      const st = (snapshot.statuses && snapshot.statuses[agent.id]) || 'idle';
      const isActive = agent.id === snapshot.activeAgentId;
      btn.type = 'button';
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      btn.className = 'tab' + (isActive ? ' active' : '');
      if (st === 'error') btn.className += ' error';
      const name = document.createElement('span');
      name.textContent = agent.name;
      btn.appendChild(name);
      if (st === 'sending' || st === 'waiting') {
        const spinner = document.createElement('span');
        spinner.className = 'tab-spinner tab-spinner-' + st;
        spinner.setAttribute('aria-label', st === 'sending' ? '发送中' : '等待回复');
        spinner.title = st === 'sending' ? '发送中' : '等待回复';
        btn.appendChild(spinner);
      }
      btn.addEventListener('click', function () {
        post('selectAgent', { agentId: agent.id });
      });
      tabsEl.appendChild(btn);
    });

    // 当前 Agent：waiting/sending 时改为停止；已连 Host 但尚未就绪（无 status）禁用
    const sendBtn = document.getElementById('sendBtn');
    const activeId = snapshot.activeAgentId;
    const activeSt =
      activeId && snapshot.statuses && snapshot.statuses[activeId] !== undefined
        ? snapshot.statuses[activeId]
        : undefined;
    const busy = activeSt === 'sending' || activeSt === 'waiting';
    const pendingInit = !activeSt && !!snapshot.hostReady;
    const prevSendText = sendBtn.textContent;
    if (busy && activeId) {
      sendBtn.dataset.mode = 'stop';
      sendBtn.textContent = '停止';
      sendBtn.disabled = false;
    } else {
      sendBtn.dataset.mode = 'send';
      sendBtn.textContent = '发送';
      sendBtn.disabled = !activeId || pendingInit;
    }
    if (planBtn) planBtn.disabled = !activeId || busy || pendingInit || !snapshot.workspaceRoot;
    updatePlanCreateButton();
    // 发送/停止文案宽度变化时重算溢出
    if (sendBtn.textContent !== prevSendText) scheduleToolbarOverflow();

    if (isConfigDialogOpen()) renderPermissions(snapshot);

    const openCallToolKeys = getOpenCallToolKeys();
    chatEl.innerHTML = '';
    (snapshot.chats || []).forEach(function (c) {
      if (snapshot.activeAgentId && c.agentId !== snapshot.activeAgentId && c.role !== 'system') {
        return;
      }
      const div = document.createElement('div');
      div.className = 'bubble ' + c.role;
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = c.role + (c.agentId ? ' · ' + c.agentId : '');
      const body = document.createElement('div');
      body.className = 'md-body';
      if (c.role === 'system') {
        body.textContent = c.text;
      } else if (c.role === 'agent' && Array.isArray(c.displayParts) && c.displayParts.length > 0) {
        renderDisplayParts(body, c.displayParts, openCallToolKeys);
      } else {
        body.innerHTML = renderMarkdown(c.text);
      }
      div.appendChild(meta);
      div.appendChild(body);
      chatEl.appendChild(div);
    });
    chatEl.scrollTop = chatEl.scrollHeight;

    logsEl.innerHTML = '';
    (snapshot.logs || []).slice().reverse().forEach(function (log) {
      const line = document.createElement('div');
      line.className = log.status === 'error' ? 'log-error' : 'log-applied';
      line.textContent =
        log.action +
        (log.path ? ' ' + log.path : '') +
        (log.message ? ' — ' + log.message : '');
      logsEl.appendChild(line);
    });
  }

  /** 追加路径引用到侧栏输入框 */
  function fillComposer(text) {
    const addition = String(text || '');
    if (!addition) return;
    const existing = inputEl.value || '';
    if (!existing.trim()) {
      inputEl.value = addition;
    } else {
      const trimmedEnd = existing.replace(/\s+$/, '');
      inputEl.value = trimmedEnd + '\n\n' + addition;
    }
    inputEl.focus();
  }

  window.addEventListener('message', function (event) {
    const msg = event.data;
    if (msg && msg.type === 'snapshot') render(msg.data || {});
    if (msg && msg.type === 'debugDialog') {
      openDebugDialog(msg.kind, msg.title, msg.body);
    }
    if (msg && msg.type === 'fillComposer') {
      fillComposer(msg.text);
    }
    if (msg && msg.type === 'planCreated') {
      planSubmitting = false;
      closePlanDialog();
    }
    if (msg && msg.type === 'planError') {
      planSubmitting = false;
      planError.textContent = String(msg.message || '创建计划失败');
      updatePlanCreateButton();
    }
  });

  post('ready');
})();
