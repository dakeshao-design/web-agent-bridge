# 新站点桥接模板

复制下方代码块为 `scripts/xxx-bridge.js` 后按站点 DOM 改写。

运行时由 `bridge-default.js` 提供基础能力；本文件为文档，不参与扫描。

## 站点注册契约

- 头注释 `@readFileLineLimit` / `@writeFileLineLimit`：读写行限
- 可选头注释 `@waitBeforeSend`：点击发送后等待毫秒（未设置按 300），若未 loading 且 lastUser/lastAgent 的 key 未变则重试，最多 10 次
- 可选头注释 `@newChatOnload`：默认 false；true 时 `getComposer().input` 非 null 后通知 Host 注入 Agent 模式提示词（有 `newChatSession` 则先调用）
- 可选头注释 `@inputMode` / `@typeStrategy` / `@typeDelayMs`
- 可选 `SITE_AGENT_PROMPT`：站点专用提示词，注入 Agent 模式时原样追加到提示词末尾（不自动加标题）
- 可选 `newChatSession?(currentDocument)` → `Promise`：开启新会话，resolve 表示已就绪
- `pollSnapshot(currentDocument)` → `{ loading, lastUser / lastAgent: { index, text } | null, responseRoot?: Element | null }`
  - `loading` 时 `lastUser` / `lastAgent` / `responseRoot` 均为 `null`
  - 查询一律用 `currentDocument`，禁止写死顶层 `document`
- `getComposer?(currentDocument)` → `{ input, sendButton }`（仅 send/fill）
- `findCallToolBlocks?(responseRoot)` → `Element[]`
- `findCopyButtons?(responseRoot)` → `HTMLElement[]`（有则走复制读工具）
- `resolveCurrentDocument?()` → `Document`（iframe 站解析聊天 frame）

## 模板代码

```js
// ==BridgeScript==
// @id            example
// @name          示例 Agent
// @url           https://www.xxx.com/chat
// @description   新站点模板示例
// @enabled       false
// @inputMode     fill
// @typeStrategy  paste
// @readFileLineLimit  100
// @writeFileLineLimit 100
// @waitBeforeSend     300
// @newChatOnload      false
// ==/BridgeScript==

(function () {
  'use strict';

  // 可选：原样追加到 Agent 模式提示词末尾
  // const SITE_AGENT_PROMPT = `
  // ## 站点专用说明
  // ……
  // `;
  const REGISTER_NS = '__agentEditorBridgeRegister';

  function isLoading(doc) {
    const el = doc.querySelector('[class*="generating"], [class*="loading"]');
    return !!(el && el.offsetParent !== null);
  }

  function pollSnapshot(currentDocument) {
    const doc = currentDocument || document;
    if (isLoading(doc)) {
      return { loading: true, lastUser: null, lastAgent: null, responseRoot: null };
    }

    const nodes = doc.querySelectorAll('[class*="markdown"], [class*="assistant"]');
    let lastAgent = null;
    let responseRoot = null;
    if (nodes.length) {
      const last = nodes[nodes.length - 1];
      const text = (last.innerText || last.textContent || '').trim();
      if (text) {
        lastAgent = { index: nodes.length - 1, text };
        responseRoot = last;
      }
    }

    let lastUser = null;
    const users = doc.querySelectorAll('[class*="user"], [class*="question"]');
    for (let i = users.length - 1; i >= 0; i--) {
      const text = (users[i].innerText || users[i].textContent || '').trim();
      if (text) {
        lastUser = { index: i, text };
        break;
      }
    }

    return { loading: false, lastUser, lastAgent, responseRoot };
  }

  function getComposer(currentDocument) {
    const doc = currentDocument || document;
    return {
      input: doc.querySelector('textarea'),
      sendButton: doc.querySelector('button[type="submit"]'),
    };
  }

  function findCallToolBlocks(responseRoot) {
    const scope = responseRoot;
    if (!scope || !scope.querySelectorAll) return [];
    const blocks = [];
    const seen = new Set();
    const nodes = scope.querySelectorAll('pre, [class*="code-block"], [class*="codeBlock"]');
    for (let i = 0; i < nodes.length; i++) {
      const block = nodes[i];
      if (seen.has(block)) continue;
      const codeEl = block.querySelector('code, pre') || block;
      const codeText = (codeEl.textContent || '').trim();
      if (!codeText.includes('BEGIN_TOOL')) continue;
      seen.add(block);
      blocks.push(block);
    }
    return blocks;
  }

  // 可选：启用复制读工具时实现
  // function findCopyButtons(responseRoot) {
  //   return [];
  // }

  // 可选：开启新会话，Promise resolve 表示已就绪
  // async function newChatSession(currentDocument) {
  //   // 点击站点「新对话」等
  // }

  if (typeof window[REGISTER_NS] === 'function') {
    window[REGISTER_NS]({
      pollSnapshot,
      getComposer,
      findCallToolBlocks,
      // findCopyButtons,
      // newChatSession,
    });
  }
})();
```
