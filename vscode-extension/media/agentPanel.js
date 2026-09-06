(function () {
  const vscode = acquireVsCodeApi();
  const tabsEl = document.getElementById('tabs');
  const chatEl = document.getElementById('chat');
  const logsEl = document.getElementById('logs');
  const inputEl = document.getElementById('input');
  const hostStatusEl = document.getElementById('hostStatus');
  const permissionsEl = document.getElementById('permissions');
  const debugToolsBtn = document.getElementById('debugToolsBtn');
  const debugMenu = document.getElementById('debugMenu');
  const debugOverlay = document.getElementById('debugOverlay');
  const debugDialogTitle = document.getElementById('debugDialogTitle');
  const debugDialogBody = document.getElementById('debugDialogBody');
  const debugDialogPrimary = document.getElementById('debugDialogPrimary');
  const debugDialogClose = document.getElementById('debugDialogClose');
  const debugDialogCloseX = document.getElementById('debugDialogCloseX');
  let showPermissions = false;
  let lastSnapshot = null;
  let debugDialogKind = null;

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

  function setDebugMenuOpen(open) {
    if (!debugMenu) return;
    if (open) debugMenu.classList.remove('hidden');
    else debugMenu.classList.add('hidden');
  }

  function closeDebugDialog() {
    debugDialogKind = null;
    if (debugOverlay) debugOverlay.classList.add('hidden');
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

  document.querySelectorAll('[data-cmd]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const cmd = btn.getAttribute('data-cmd');
      if (cmd === 'showPermissions') {
        showPermissions = !showPermissions;
        if (lastSnapshot) render(lastSnapshot);
        return;
      }
      post(cmd);
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
        if (action === 'agentModePrompt') post('getAgentModePrompt');
        else if (action === 'lastCallTool') post('getLastCallTool');
        else if (action === 'stopTerminal') post('killTerminal');
      });
    });
  }

  document.addEventListener('click', function () {
    setDebugMenuOpen(false);
  });

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
    const text = inputEl.value;
    if (!text.trim()) return;
    post('send', { text: text });
    inputEl.value = '';
  });

  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      document.getElementById('sendBtn').click();
    }
  });

  function renderPermissions(snapshot) {
    if (!permissionsEl) return;
    if (!showPermissions) {
      permissionsEl.classList.add('hidden');
      permissionsEl.innerHTML = '';
      return;
    }
    permissionsEl.classList.remove('hidden');
    permissionsEl.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'perm-title';
    title.textContent = '工具权限（允许 / 询问 / 禁止）';
    permissionsEl.appendChild(title);

    const perms = snapshot.toolPermissions || {};
    const tools = snapshot.toolsForSettings || [];
    tools.forEach(function (tool) {
      const row = document.createElement('div');
      row.className = 'perm-row';

      const name = document.createElement('div');
      name.className = 'perm-name';
      name.textContent = tool.name;

      const desc = document.createElement('div');
      desc.className = 'perm-desc';
      desc.textContent = tool.description || '';

      const modes = document.createElement('div');
      modes.className = 'perm-modes';
      const current = perms[tool.name] || 'allow';
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
      permissionsEl.appendChild(row);
    });

    const actions = document.createElement('div');
    actions.className = 'perm-actions';
    const saveBtn = document.createElement('button');
    saveBtn.textContent = '保存权限';
    saveBtn.addEventListener('click', function () {
      post('saveToolPermissions', { permissions: snapshot.toolPermissions || {} });
    });
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '关闭';
    closeBtn.addEventListener('click', function () {
      showPermissions = false;
      if (lastSnapshot) render(lastSnapshot);
    });
    actions.appendChild(saveBtn);
    actions.appendChild(closeBtn);
    permissionsEl.appendChild(actions);
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
      btn.className = 'tab' + (agent.id === snapshot.activeAgentId ? ' active' : '');
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

    renderPermissions(snapshot);

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

  window.addEventListener('message', function (event) {
    const msg = event.data;
    if (msg && msg.type === 'snapshot') render(msg.data || {});
    if (msg && msg.type === 'togglePermissions') {
      showPermissions = !!msg.show;
      if (lastSnapshot) render(lastSnapshot);
    }
    if (msg && msg.type === 'debugDialog') {
      openDebugDialog(msg.kind, msg.title, msg.body);
    }
  });

  post('ready');
})();
