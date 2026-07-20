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

// Per-session operation chains. Saves and deletes for one session id run
// strictly in order: concurrent debounced saves can no longer interleave on
// the shared .tmp file, and a delete queued after an in-flight save removes
// the file the save produced instead of racing it (which used to resurrect
// deleted sessions on the next restart).
const chains = new Map<string, Promise<unknown>>();

function enqueue<T>(id: string, op: () => Promise<T>): Promise<T> {
  const prev = chains.get(id) ?? Promise.resolve();
  const run = prev.then(op, op);
  chains.set(
    id,
    run.catch((err) => console.error(`[store] write failed for ${id}:`, err)),
  );
  return run;
}

/** Resolves when every queued session write/delete has settled. Await this
 *  on shutdown so the final flush actually reaches disk. */
export async function flushWrites(): Promise<void> {
  await Promise.all([...chains.values()]);
}

/** Atomic write: write to a temp file then rename over the target. */
export function saveSession(data: PersistedSession): Promise<void> {
  return enqueue(data.meta.id, async () => {
    await ensureDirs();
    const target = sessionFile(data.meta.id);
    const tmp = `${target}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data), 'utf8');
    await fs.rename(tmp, target);
  });
}

export function deleteSessionFile(id: string): Promise<void> {
  return enqueue(id, () => fs.rm(sessionFile(id), { force: true }));
}
