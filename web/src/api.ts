// Thin REST client for everything that is not the live session stream.

import { getToken, clearToken } from './auth';

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    // The token is missing or no longer valid — drop it so the gate re-prompts.
    clearToken();
    throw new Error('unauthorized');
  }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
  return (await res.json()) as T;
}

export interface Snippet {
  id: string;
  title: string;
  body: string;
  createdAt: number;
}

export interface SkillInfo {
  name: string;
  description: string | null;
  path: string;
}

export interface DirListing {
  path: string;
  parent: string;
  dirs: { name: string; path: string }[];
}

/** An MCP server launched locally over stdio. */
export interface McpStdioServer {
  type?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/** A remote MCP server reached over HTTP or SSE. */
export interface McpRemoteServer {
  type: 'http' | 'sse';
  url: string;
  headers?: Record<string, string>;
}

export type McpServer = McpStdioServer | McpRemoteServer;
export type McpServers = Record<string, McpServer>;

export const api = {
  auth: () => req<{ ok: true }>('GET', '/auth'),
  snippets: () => req<Snippet[]>('GET', '/snippets'),
  addSnippet: (title: string, body: string) => req<Snippet>('POST', '/snippets', { title, body }),
  deleteSnippet: (id: string) => req<{ ok: true }>('DELETE', `/snippets/${id}`),
  skills: () => req<SkillInfo[]>('GET', '/claude/skills'),
  settings: () => req<Record<string, unknown>>('GET', '/claude/settings'),
  saveSettings: (s: Record<string, unknown>) => req<{ ok: true }>('PUT', '/claude/settings', s),
  mcp: () => req<McpServers>('GET', '/mcp'),
  saveMcp: (servers: McpServers) => req<{ ok: true }>('PUT', '/mcp', servers),
  pushVapid: () => req<{ publicKey: string }>('GET', '/push/vapid'),
  pushSubscribe: (sub: unknown) => req<{ ok: true }>('POST', '/push/subscribe', sub),
  pushUnsubscribe: (endpoint: string) =>
    req<{ ok: true }>('POST', '/push/unsubscribe', { endpoint }),
  fsList: (path?: string) =>
    req<DirListing>('GET', `/fs/list${path ? `?path=${encodeURIComponent(path)}` : ''}`),
};
