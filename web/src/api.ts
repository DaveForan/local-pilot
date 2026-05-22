// Thin REST client for everything that is not the live session stream.

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
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

export const api = {
  snippets: () => req<Snippet[]>('GET', '/snippets'),
  addSnippet: (title: string, body: string) => req<Snippet>('POST', '/snippets', { title, body }),
  deleteSnippet: (id: string) => req<{ ok: true }>('DELETE', `/snippets/${id}`),
  skills: () => req<SkillInfo[]>('GET', '/claude/skills'),
  settings: () => req<Record<string, unknown>>('GET', '/claude/settings'),
  saveSettings: (s: Record<string, unknown>) => req<{ ok: true }>('PUT', '/claude/settings', s),
  fsList: (path?: string) =>
    req<DirListing>('GET', `/fs/list${path ? `?path=${encodeURIComponent(path)}` : ''}`),
};
