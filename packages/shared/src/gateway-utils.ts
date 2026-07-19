/**
 * Gateway API 工具函数
 * 用于处理 Clash/Surge 后端的通用逻辑
 */

export type BackendType = 'clash' | 'surge' | 'passwall';

export interface BackendConfig {
  id: number;
  name: string;
  url: string;
  token: string;
  type: BackendType;
  enabled: boolean;
  is_active: boolean;
  listening: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * 构建 Gateway API 请求头
 */
export function buildGatewayHeaders(
  backend: Pick<BackendConfig, 'type' | 'token'>,
  extraHeaders: Record<string, string> = {}
): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    ...extraHeaders,
  };

  if (backend.token) {
    if (backend.type === 'surge') {
      headers['x-key'] = backend.token;
    } else {
      headers['Authorization'] = `Bearer ${backend.token}`;
    }
  }

  return headers;
}

/**
 * 解析 Surge 规则字符串
 * 支持格式: TYPE,PAYLOAD,POLICY 或 TYPE,POLICY
 */
export function parseSurgeRule(raw: string): { type: string; payload: string; policy: string } | null {
  const trimmed = raw.trim();
  
  // Skip empty lines and comments
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  const parts = trimmed.split(',').map(p => p.trim());
  if (parts.length < 2) {
    return null;
  }

  const type = parts[0];
  
  // Helper to remove surrounding quotes from policy names
  const unquote = (str: string) => str?.replace(/^["']|["']$/g, '') || '';
  
  // Handle different rule types
  if (type === 'FINAL') {
    return { type: 'MATCH', payload: '*', policy: unquote(parts[1]) || 'DIRECT' };
  }
  
  if (type === 'GEOIP') {
    return { type: 'GEOIP', payload: parts[1] || '', policy: unquote(parts[2]) || 'DIRECT' };
  }
  
  if (type === 'RULE-SET') {
    return { type: 'RULE-SET', payload: parts[1] || '', policy: unquote(parts[2]) || 'DIRECT' };
  }
  
  // Generic format: TYPE,payload,policy
  if (parts.length >= 3) {
    return { type, payload: parts[1], policy: unquote(parts[2]) };
  }
  
  // Fallback: TYPE,policy
  return { type, payload: '', policy: unquote(parts[1]) || 'DIRECT' };
}

/**
 * 解析 Surge 规则（支持对象或字符串格式）
 * 用于前端 active-chain.ts
 */
export function parseGatewayRule(rule: unknown): { payload?: string; proxy: string } | null {
  if (typeof rule === 'string') {
    const parsed = parseSurgeRule(rule);
    if (!parsed) return null;
    return {
      payload: parsed.payload,
      proxy: parsed.policy,
    };
  } else if (typeof rule === 'object' && rule !== null) {
    const r = rule as Record<string, unknown>;
    // Validate at runtime so the non-optional `proxy` return type holds.
    if (typeof r.proxy !== 'string' || !r.proxy) return null;
    return {
      payload: typeof r.payload === 'string' ? r.payload : undefined,
      proxy: r.proxy,
    };
  }
  return null;
}

/**
 * 提取 Gateway 基础 URL
 * 将 WebSocket URL 转换为 HTTP URL，移除路径
 */
export function getGatewayBaseUrl(url: string): string {
  return url
    .replace(/^ws:\/\//, 'http://')
    .replace(/^wss:\/\//, 'https://')
    .replace(/\/connections\/?$/, '')
    .replace(/\/$/, '');
}

/**
 * 判断是否为 Agent 被动上报后端
 * 约定：backend.url 以 agent:// 开头
 */
export function isAgentBackendUrl(url: string): boolean {
  return /^agent:\/\//i.test((url || '').trim());
}
