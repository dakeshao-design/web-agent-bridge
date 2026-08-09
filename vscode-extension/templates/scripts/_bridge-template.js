/**
 * 新站点桥接模板
 * 复制为 scripts/xxx-bridge.js 后按站点 DOM 改写
 * 运行时由 bridge-default.js 提供基础能力，本文件不参与加载
 *
 * === agents.json 配置项 ===
 * injectScript  桥接脚本路径
 * url           站点聊天页地址
 * enabled       是否启用
 * inputMode     输入方式：fill 直接赋值，type 模拟键入
 * typeStrategy  键入策略：keyboard / exec / paste
 * typeDelayMs   逐字输入间隔毫秒
 * readToolViaCopy  是否通过复制按钮读取 call-tool 文本
 * fileCommandPrefix  文件命令前缀，如 @file
 *
 * === site.selectors ===
 * 函数或 CSS 字符串
 * input              输入框元素
 * sendButton         发送按钮元素
 * responseContainer  最新回复容器
 * loadingIndicator   生成中指示元素，用于等待流式结束
 * getLatestResponse  最新回复文本，返回 { key, text }
 *
 * === site.adapter 可选覆盖 ===
 * findCallToolBlocks      查找含 BEGIN_TOOL 的代码块
 * findCopyButtonInBlock   在代码块内查找复制按钮
 * resolveToolBlockRoot    向上查找含复制按钮的容器
 * findToolCodeText        从 DOM 读取工具代码文本
 * getLatestResponseMeta   获取最新回复，优先于 getLatestResponse
 * getCopyDebugExtra       复制调试附加信息
 * captureConversation     可选：返回会话消息数组 { key, role, text }[]
 */
(function () {
  'use strict';

  const FILE_LINE_LIMIT = 100;

  // 站点注册入口，由 bridge-default.js 提供
  const REGISTER_NS = '__agentEditorBridgeRegister';

  // 站点 DOM 适配，覆盖 bridge-default 默认实现
  const adapter = {
    // 在范围内查找 call-tool 代码块列表
    findCallToolBlocks(root) {
      const scope = root || document;
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
        blocks.push(adapter.resolveToolBlockRoot(block));
      }
      return blocks;
    },

    // 向上查找包含复制按钮的父级容器
    resolveToolBlockRoot(block) {
      if (!block) return block;
      let node = block;
      for (let depth = 0; depth < 5 && node; depth++) {
        const hasCopy = node.querySelector(
          '[class*="copy"], [aria-label*="复制"], [title*="复制"]'
        );
        if (hasCopy) return node;
        node = node.parentElement;
      }
      return block;
    },

    // 在代码块中定位复制按钮
    findCopyButtonInBlock(block) {
      const root = adapter.resolveToolBlockRoot(block);
      const candidates = root.querySelectorAll(
        '[role="button"], button, a, [class*="copy"], [aria-label*="复制"], [title*="复制"]'
      );
      for (let i = 0; i < candidates.length; i++) {
        const el = candidates[i];
        const label =
          (el.getAttribute('aria-label') || '') +
          (el.getAttribute('title') || '') +
          (el.textContent || '') +
          (el.className || '');
        if (/复制|copy/i.test(label)) return el;
      }
      return null;
    },

    // 从页面 DOM 提取含 BEGIN_TOOL 的代码文本
    findToolCodeText(root) {
      const scope = root || document;
      const codes = scope.querySelectorAll('pre code, code');
      for (let i = codes.length - 1; i >= 0; i--) {
        const text = (codes[i].textContent || '').trim();
        if (text.includes('BEGIN_TOOL')) return text;
      }
      return '';
    },

    // 可选：虚拟列表场景下获取带 key 的最新回复
    // getLatestResponseMeta() {
    //   return { key: -1, text: '' };
    // },

    // 可选：会话列表抓取，供 Host 同步对话
    // captureConversation() {
    //   return [];
    // },

    // 可选：复制调试时返回附加字段
    // getCopyDebugExtra(block, btn) {
    //   return { hasCosIcon: false };
    // },
  };

  // 页面元素选择器，函数或 CSS 字符串均可
  const selectors = {
    // 聊天输入框
    input() {
      return document.querySelector('textarea');
    },

    // 发送按钮
    sendButton() {
      return document.querySelector('button[type="submit"]');
    },

    // 最新一条 Agent 回复的容器
    responseContainer() {
      const nodes = document.querySelectorAll('[class*="markdown"]');
      return nodes.length ? nodes[nodes.length - 1] : null;
    },

    // 回复生成中的加载指示，可见时暂停轮询
    loadingIndicator() {
      const el = document.querySelector('[class*="generating"], [class*="loading"]');
      return el && el.offsetParent !== null ? el : null;
    },

    // 读取最新回复，优先返回工具代码块
    getLatestResponse() {
      const toolText = adapter.findToolCodeText(document);
      if (toolText) return { key: -1, text: toolText };
      const container = selectors.responseContainer();
      if (!container) return { key: -1, text: '' };
      return { key: -1, text: (container.innerText || container.textContent || '').trim() };
    },
  };

  // 向 bridge-default 注册本站点配置
  if (typeof window[REGISTER_NS] === 'function') {
    window[REGISTER_NS]({ adapter, selectors, fileLineLimit: FILE_LINE_LIMIT });
  }
})();
