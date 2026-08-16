import type { AgentConfig, AgentInputMode, AgentTypeStrategy } from '../config/types.js';

const BLOCK_RE =
  /\/\/\s*==BridgeScript==\s*([\s\S]*?)\/\/\s*==\/BridgeScript==/;

/** 是否应作为站点桥接脚本扫描 */
export function isSiteBridgeScriptFileName(name: string): boolean {
  if (!name.endsWith('.js')) return false;
  if (name.startsWith('_')) return false;
  if (name === 'bridge-default.js') return false;
  return true;
}

function parseTagMap(blockBody: string): Map<string, string> {
  const map = new Map<string, string>();
  const lines = blockBody.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/\/\/\s*@(\w+)\s+(.+?)\s*$/);
    if (!m) continue;
    map.set(m[1], m[2].trim());
  }
  return map;
}

function parseEnabled(raw: string | undefined): boolean | undefined {
  if (raw == null) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return undefined;
}

/**
 * 从桥接头注释解析 AgentConfig。
 * @description 仅文档，忽略不入配置。
 */
export function parseBridgeScriptMeta(
  source: string,
  fallbackRelativePath?: string
): AgentConfig | null {
  const block = source.match(BLOCK_RE);
  if (!block) return null;
  const tags = parseTagMap(block[1]);

  const id = tags.get('id');
  const name = tags.get('name');
  const url = tags.get('url');
  const enabled = parseEnabled(tags.get('enabled'));
  if (!id || !name || !url || enabled === undefined) return null;

  const injectScript = fallbackRelativePath
    ? fallbackRelativePath.replace(/\\/g, '/')
    : `scripts/${id}-bridge.js`;

  const agent: AgentConfig = {
    id,
    name,
    url,
    enabled,
    injectScript,
  };

  const inputMode = tags.get('inputMode');
  if (inputMode === 'fill' || inputMode === 'type') {
    agent.inputMode = inputMode as AgentInputMode;
  }

  const typeStrategy = tags.get('typeStrategy');
  if (typeStrategy === 'keyboard' || typeStrategy === 'exec' || typeStrategy === 'paste') {
    agent.typeStrategy = typeStrategy as AgentTypeStrategy;
  }

  const typeDelayRaw = tags.get('typeDelayMs');
  if (typeDelayRaw != null) {
    const n = Number.parseInt(typeDelayRaw, 10);
    if (Number.isFinite(n) && n >= 0) agent.typeDelayMs = n;
  }

  return agent;
}
