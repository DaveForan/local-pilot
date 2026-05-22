import { existsSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { Session } from './session';
import type { SessionHooks } from './session';
import type { Broadcaster } from './wsHub';
import { saveSession, deleteSessionFile, loadAllSessions } from './store';
import { DEFAULT_CWD } from './config';
import type { SessionMeta, PermissionMode, PermissionDecision } from './protocol';

/** Owns every Session, wires their hooks to the WebSocket broadcaster. */
export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  private broadcaster: Broadcaster | null = null;

  setBroadcaster(b: Broadcaster): void {
    this.broadcaster = b;
  }

  async init(): Promise<void> {
    for (const persisted of await loadAllSessions()) {
      // A process restart means no live runner — anything that was running is
      // now idle (and resumable via meta.claudeSessionId on the next message).
      if (persisted.meta.status !== 'ended') persisted.meta.status = 'idle';
      this.sessions.set(
        persisted.meta.id,
        new Session(persisted.meta, persisted.events, this.hooks()),
      );
    }
    console.log(`[manager] loaded ${this.sessions.size} session(s)`);
  }

  list(): SessionMeta[] {
    return [...this.sessions.values()]
      .map((s) => s.meta)
      .sort((a, b) => b.lastActivity - a.lastActivity);
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  create(opts: {
    cwd?: string;
    title?: string;
    model?: string | null;
    permissionMode?: PermissionMode;
  }): Session {
    const cwd = opts.cwd?.trim() || DEFAULT_CWD;
    if (!existsSync(cwd)) throw new Error(`Directory does not exist: ${cwd}`);
    const now = Date.now();
    const meta: SessionMeta = {
      id: nanoid(12),
      title: opts.title?.trim() || basename(cwd),
      cwd,
      model: opts.model ?? null,
      permissionMode: opts.permissionMode ?? 'default',
      status: 'idle',
      createdAt: now,
      lastActivity: now,
      eventCount: 0,
      claudeSessionId: null,
    };
    const session = new Session(meta, [], this.hooks());
    this.sessions.set(meta.id, session);
    this.broadcaster?.toAll({ t: 'session', session: meta });
    void saveSession(session.toPersisted());
    return session;
  }

  async delete(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    session.dispose();
    this.sessions.delete(id);
    await deleteSessionFile(id);
    this.broadcaster?.toAll({ t: 'deleted', sessionId: id });
  }

  input(id: string, text: string): void {
    this.require(id).sendInput(text);
  }

  interrupt(id: string): void {
    void this.require(id).interrupt();
  }

  resolvePermission(id: string, requestId: string, decision: PermissionDecision): void {
    this.require(id).resolvePermission(requestId, decision);
  }

  setMode(id: string, mode: PermissionMode): void {
    this.require(id).setMode(mode);
  }

  disposeAll(): void {
    for (const session of this.sessions.values()) session.dispose();
  }

  private require(id: string): Session {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Unknown session: ${id}`);
    return session;
  }

  private hooks(): SessionHooks {
    return {
      onEvent: (sessionId, event) =>
        this.broadcaster?.toSession(sessionId, { t: 'event', sessionId, event }),
      onMeta: (meta) => this.broadcaster?.toAll({ t: 'session', session: meta }),
      onPermission: (request) =>
        this.broadcaster?.toSession(request.sessionId, { t: 'permission', request }),
      persist: (session) => {
        void saveSession(session.toPersisted());
      },
    };
  }
}

function basename(dir: string): string {
  return dir.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || dir;
}
