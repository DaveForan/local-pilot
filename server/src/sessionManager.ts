import { existsSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { Session } from './session';
import type { SessionHooks } from './session';
import type { Broadcaster } from './wsHub';
import { saveSession, deleteSessionFile, loadAllSessions } from './store';
import { sendPush } from './push';
import { publishNtfy } from './ntfy';
import { DEFAULT_CWD } from './config';
import { discover } from './claudeRunner';
import type {
  SessionMeta,
  PermissionMode,
  PermissionDecision,
  ChatImage,
  ModelInfo,
  EffortLevel,
  SlashCommand,
  McpServerStatus,
  AccountInfo,
} from './protocol';

/** Owns every Session, wires their hooks to the WebSocket broadcaster. */
export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  private broadcaster: Broadcaster | null = null;
  /** Account-wide model list. Seeded by a startup discovery probe and kept
   *  fresh by any running session's control channel. */
  private cachedModels: ModelInfo[] = [];
  /** Slash commands — same seeding/refresh path as the model list. */
  private cachedSlashCommands: SlashCommand[] = [];
  /** Authenticated account info — populated lazily by a running session. */
  private cachedAccount: AccountInfo | null = null;
  /** Memoizes the one-shot SDK discovery probe so concurrent callers share it. */
  private catalogProbe: Promise<void> | null = null;

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

  slashCommands(): SlashCommand[] {
    return this.cachedSlashCommands;
  }

  /** Probe the SDK once for the account's real model catalog + slash commands
   *  so the New Session dialog can show them before any session exists. The
   *  result is memoized; awaiting it from a request handler is cheap after the
   *  first call. Best-effort — a failure leaves the cached lists untouched. */
  ensureCatalogs(): Promise<void> {
    if (!this.catalogProbe) {
      this.catalogProbe = discover(DEFAULT_CWD)
        .then(({ models, slashCommands }) => {
          if (models.length === 0 && slashCommands.length === 0) {
            // discover() reports failure as empty lists (it never rejects), so
            // the .catch below can't fire. Don't memoize a failed probe — that
            // would leave the New Session dialog empty for the process
            // lifetime. Reset so the next request retries.
            console.warn('[manager] catalog discovery returned nothing — will retry');
            this.catalogProbe = null;
            return;
          }
          if (models.length > 0) this.cachedModels = models;
          if (slashCommands.length > 0) this.cachedSlashCommands = slashCommands;
          console.log(
            `[manager] discovered ${this.cachedModels.length} model(s), ` +
              `${this.cachedSlashCommands.length} slash command(s)`,
          );
        })
        .catch((err) => {
          console.warn('[manager] catalog discovery failed:', err);
          // Allow a later caller to retry rather than caching the failure.
          this.catalogProbe = null;
        });
    }
    return this.catalogProbe;
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
    effort?: EffortLevel | null;
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
      effort: opts.effort ?? null,
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

  /** Branch a session: copy its timeline into a new session and, when the
   *  source has a Claude session id, mark it pendingFork so the first runner
   *  start forks the SDK conversation (full context, independent future). */
  fork(id: string): Session {
    const source = this.require(id);
    const now = Date.now();
    const meta: SessionMeta = {
      id: nanoid(12),
      title: `${source.meta.title} (fork)`,
      cwd: source.meta.cwd,
      model: source.meta.model,
      effort: source.meta.effort ?? null,
      permissionMode: source.meta.permissionMode,
      status: 'idle',
      createdAt: now,
      lastActivity: now,
      eventCount: source.events.length,
      claudeSessionId: source.meta.claudeSessionId,
      pendingFork: source.meta.claudeSessionId ? true : undefined,
      tags: source.meta.tags ? [...source.meta.tags] : undefined,
      slashCommands: source.meta.slashCommands,
      outputStyle: source.meta.outputStyle,
      contextWindow: source.meta.contextWindow,
    };
    // Deep-copy the timeline so the two sessions can't share mutable events
    // (permission status flips, userUuid patches).
    const events = JSON.parse(JSON.stringify(source.events)) as typeof source.events;
    const session = new Session(meta, events, this.hooks());
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

  setModel(id: string, model: string | null): void {
    this.require(id).setModel(model);
  }

  setEffort(id: string, effort: EffortLevel | null): void {
    this.require(id).setEffort(effort);
  }

  rename(id: string, title: string): void {
    this.require(id).rename(title);
  }

  setArchived(id: string, archived: boolean): void {
    this.require(id).setArchived(archived);
  }

  setTags(id: string, tags: string[]): void {
    this.require(id).setTags(tags);
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
            event.isError
              ? 'Turn ended with an error'
              : previewText(event.text) || 'Turn complete',
          );
        }
      },
      onPartial: (sessionId, text) => {
        this.broadcaster?.toSession(sessionId, { t: 'partial', sessionId, text });
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
        if (models.length > 0) this.cachedModels = models;
      },
      onSlashCommands: (commands) => {
        if (commands.length > 0) this.cachedSlashCommands = commands;
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
    publishNtfy({ title, body, sessionId });
  }
}

function basename(dir: string): string {
  return dir.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || dir;
}

/** Condense an assistant reply into a one-line notification preview: the
 *  beginning of the response, with code blocks and markdown markers stripped
 *  and whitespace collapsed. Returns '' when there's no usable text. */
function previewText(text: string, max = 140): string {
  const clean = (text ?? '')
    .replace(/```[\s\S]*?```/g, ' ') // drop fenced code blocks
    .replace(/[`*_#>]/g, '') // strip common markdown markers
    .replace(/\s+/g, ' ') // collapse newlines/whitespace
    .trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1).trimEnd() + '…';
}
