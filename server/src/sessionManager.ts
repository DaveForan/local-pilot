import { existsSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { Session } from './session';
import type { SessionHooks } from './session';
import type { Broadcaster } from './wsHub';
import { saveSession, deleteSessionFile, loadAllSessions } from './store';
import { sendPush } from './push';
import { DEFAULT_CWD } from './config';
import type {
  SessionMeta,
  PermissionMode,
  PermissionDecision,
  ChatImage,
  ModelInfo,
  McpServerStatus,
  AccountInfo,
} from './protocol';

/** Owns every Session, wires their hooks to the WebSocket broadcaster. */
export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  private broadcaster: Broadcaster | null = null;
  /** Account-wide model list, populated lazily by any running session.
   *  Empty until the first session's runner has started. */
  private cachedModels: ModelInfo[] = [];
  /** Authenticated account info — same lazy population. */
  private cachedAccount: AccountInfo | null = null;

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

  models(): ModelInfo[] {
    return this.cachedModels;
  }

  account(): AccountInfo | null {
    return this.cachedAccount;
  }

  /** Query MCP status from any session with a live runner. Returns null when
   *  no session is active — the SDK process is where the connections live. */
  async mcpServerStatus(): Promise<McpServerStatus[] | null> {
    for (const session of this.sessions.values()) {
      if (session.hasRunner()) {
        const status = await session.mcpServerStatus();
        if (status) return status;
      }
    }
    return null;
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

  input(id: string, text: string, images?: ChatImage[]): void {
    this.require(id).sendInput(text, images);
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

  rename(id: string, title: string): void {
    this.require(id).rename(title);
  }

  disposeAll(): void {
    for (const session of this.sessions.values()) session.dispose();
  }

  /** Tear down every in-memory session and re-load from disk. Used after a
   *  data-import to pick up the restored ~/.local-pilot/sessions/ files. */
  async reload(): Promise<void> {
    for (const session of this.sessions.values()) session.dispose();
    this.sessions.clear();
    await this.init();
    // Tell every connected client to refresh its session list.
    this.broadcaster?.toAll({ t: 'sessions', sessions: this.list() });
  }

  private require(id: string): Session {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Unknown session: ${id}`);
    return session;
  }

  private hooks(): SessionHooks {
    return {
      onEvent: (sessionId, event) => {
        this.broadcaster?.toSession(sessionId, { t: 'event', sessionId, event });
        // A finished turn is a "come back and look" moment — push it out.
        if (event.kind === 'result') {
          this.notify(
            sessionId,
            event.isError ? 'Turn ended with an error' : 'Turn complete',
          );
        }
      },
      onMeta: (meta) => this.broadcaster?.toAll({ t: 'session', session: meta }),
      onPermission: (request) => {
        this.broadcaster?.toSession(request.sessionId, { t: 'permission', request });
        this.notify(request.sessionId, `Permission needed — ${request.toolName}`);
      },
      persist: (session) => {
        void saveSession(session.toPersisted());
      },
      onModels: (models) => {
        this.cachedModels = models;
      },
      onAccount: (account) => {
        this.cachedAccount = account;
      },
    };
  }

  /** Fire a push notification tagged to a session (no-op if none subscribed). */
  private notify(sessionId: string, body: string): void {
    const title = this.sessions.get(sessionId)?.meta.title ?? 'local-pilot';
    void sendPush({ title, body, sessionId, tag: sessionId });
  }
}

function basename(dir: string): string {
  return dir.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || dir;
}
