import fs from 'node:fs/promises';
import path from 'node:path';
import { paths } from './config';
import type { SessionMeta, SessionEvent } from './protocol';

/** A session as written to disk — survives server restarts. */
export interface PersistedSession {
  meta: SessionMeta;
  events: SessionEvent[];
}

export async function ensureDirs(): Promise<void> {
  await fs.mkdir(paths.sessions, { recursive: true });
}

function sessionFile(id: string): string {
  return path.join(paths.sessions, `${id}.json`);
}

export async function loadAllSessions(): Promise<PersistedSession[]> {
  await ensureDirs();
  const files = await fs.readdir(paths.sessions).catch(() => [] as string[]);
  const out: PersistedSession[] = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const raw = await fs.readFile(path.join(paths.sessions, f), 'utf8');
      out.push(JSON.parse(raw) as PersistedSession);
    } catch (err) {
      console.error(`[store] failed to load ${f}:`, err);
    }
  }
  return out;
}

/** Atomic write: write to a temp file then rename over the target. */
export async function saveSession(data: PersistedSession): Promise<void> {
  await ensureDirs();
  const target = sessionFile(data.meta.id);
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data), 'utf8');
  await fs.rename(tmp, target);
}

export async function deleteSessionFile(id: string): Promise<void> {
  await fs.rm(sessionFile(id), { force: true });
}
