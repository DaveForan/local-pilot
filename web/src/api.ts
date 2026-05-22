// Thin REST client for everything that is not the live session stream.
// Auth rides on an HttpOnly session cookie, so requests carry no secret.

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let message = res.status === 401 ? 'unauthorized' : `${method} ${path} → ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      /* no JSON body */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

/** Upload an audio clip for server-side Whisper transcription. */
async function transcribeAudio(audio: Blob): Promise<string> {
  const res = await fetch('/api/transcribe', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': audio.type || 'audio/webm' },
    body: audio,
  });
  if (!res.ok) {
    let message = `transcribe → ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      /* no JSON body */
    }
    throw new Error(message);
  }
  return ((await res.json()) as { text: string }).text;
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
  login: (token: string) => req<{ ok: true }>('POST', '/login', { token }),
  logout: () => req<{ ok: true }>('POST', '/logout'),
  transcribeStatus: () => req<{ available: boolean }>('GET', '/transcribe/status'),
  transcribe: transcribeAudio,
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
