import { nanoid } from 'nanoid';
import { ClaudeRunner } from './claudeRunner';
import type { RunnerEvent, PermissionOutcome, RewindResult } from './claudeRunner';
import { readMcpServersSync } from './mcpConfig';
import { buildSdkHookOptions, readHooks } from './hooks';
import { readPlugins } from './plugins';
import type { PersistedSession } from './store';
import type {
  SessionMeta,
  SessionEvent,
  SessionStatus,
  PermissionMode,
  PermissionRequest,
  PermissionDecision,
  ChatImage,
  SlashCommand,
  ModelInfo,
  EffortLevel,
  McpServerStatus,
  AccountInfo,
} from './protocol';

type PermissionEvent = Extract<SessionEvent, { kind: 'permission' }>;

/** Omit that distributes over a union (plain `Omit` collapses to common keys). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A timeline event without its server-assigned `seq`/`ts`. */
type NewEvent = DistributiveOmit<SessionEvent, 'seq' | 'ts'>;

/** Side-channel callbacks the SessionManager wires up for broadcasting + persistence. */
export interface SessionHooks {
  onEvent(sessionId: string, event: SessionEvent): void;
  /** Streaming text delta for the in-flight reply — broadcast, never persisted. */
  onPartial(sessionId: string, text: string): void;
  onMeta(meta: SessionMeta): void;
  onPermission(request: PermissionRequest): void;
  persist(session: Session): void;
  /** Cache the account-wide model list any session learns about. */
  onModels(models: ModelInfo[]): void;
  /** Cache the slash commands any session learns about (for the global list). */
  onSlashCommands(commands: SlashCommand[]): void;
  /** Cache the authenticated account info. */
  onAccount(account: AccountInfo): void;
}

/**
 * One Claude Code session: an append-only event log plus a (lazily created)
 * long-lived runner. The runner outlives browser connections — that is what
 * makes sessions reattachable.
 */
export class Session {
  meta: SessionMeta;
  events: SessionEvent[];

  private readonly hooks: SessionHooks;
  private runner: ClaudeRunner | null = null;
  private seq: number;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  /** True between a user-initiated interrupt and the next result/input — lets
   *  us present the aborted turn's error-flavored result as a clean stop
   *  instead of flagging the session (and the user's phone) with an error. */
  private interrupting = false;
  private readonly pending = new Map<
    string,
    { resolve: (o: PermissionOutcome) => void; event: PermissionEvent }
  >();

  constructor(meta: SessionMeta, events: SessionEvent[], hooks: SessionHooks) {
    this.meta = meta;
    this.events = events;
    this.hooks = hooks;
    this.seq = events.reduce((max, e) => Math.max(max, e.seq), 0);
    // Any "pending" permissions on disk are orphaned — the SDK promise that
    // could have resolved them died with the previous process. Mark them so
    // the UI doesn't pop a forever-stuck modal.
    for (const e of this.events) {
      if (e.kind === 'permission' && e.status === 'pending') {
        e.status = 'denied';
        e.resolution = 'Denied — server restarted before this was answered.';
      }
    }
  }

  // --- input ----------------------------------------------------------------

  sendInput(text: string, images?: ChatImage[]): void {
    if (this.meta.status === 'ended') return;
    this.interrupting = false;
    this.add(images && images.length > 0 ? { kind: 'user', text, images } : { kind: 'user', text });
    // Don't clobber awaiting_permission — the prompt is still unresolved and
    // the status badge should keep saying so; the new message just queues.
    if (this.meta.status !== 'awaiting_permission') this.setStatus('running');
    this.ensureRunner().send(text, images);
  }

  /** Returns null if there's no live runner. */
  hasRunner(): boolean {
    return this.runner !== null;
  }

  async mcpServerStatus(): Promise<McpServerStatus[] | null> {
    return this.runner ? this.runner.mcpServerStatus() : null;
  }

  /** Rewind files to their state at the given user message uuid.
   *  Requires a live runner — file checkpoints live in the SDK process. */
  async rewindFiles(userUuid: string, dryRun: boolean): Promise<RewindResult> {
    if (!this.runner) {
      return {
        canRewind: false,
        error:
          'No active Claude runner — file checkpoints exist only while the session is running.',
      };
    }
    const result = await this.runner.rewindFiles(userUuid, dryRun);
    if (result.canRewind && !dryRun) {
      const files = result.filesChanged ?? [];
      const summary =
        files.length === 0
          ? 'Rewind applied — no files changed.'
          : `Rewound ${files.length} file${files.length === 1 ? '' : 's'} (${result.insertions ?? 0}+/${result.deletions ?? 0}-).`;
      this.add({ kind: 'system', text: summary });
    }
    return result;
  }

  async interrupt(): Promise<void> {
    // Only arm the flag when a turn can actually be in flight, so an idle
    // interrupt can't swallow a later genuine error.
    if (this.meta.status === 'running' || this.meta.status === 'awaiting_permission') {
      this.interrupting = true;
    }
    if (this.runner) await this.runner.interrupt();
    this.failPending('Interrupted.');
    if (this.meta.status !== 'ended') this.setStatus('idle');
  }

  setMode(mode: PermissionMode): void {
    this.meta.permissionMode = mode;
    this.hooks.onMeta(this.meta);
    void this.runner?.setMode(mode);
    this.schedulePersist();
  }

  /** Switch the session's model. Updates meta (so the UI reflects it and the
   *  next runner start uses it) and, if a runner is live, switches mid-session
   *  over the SDK control channel. */
  setModel(model: string | null): void {
    if (this.meta.model === model) return;
    this.meta.model = model;
    this.hooks.onMeta(this.meta);
    void this.runner?.setModel(model);
    this.schedulePersist();
  }

  /** Change reasoning effort. Same pattern as setModel: meta + live apply when
   *  a runner exists, else picked up by Options.effort on the next start. */
  setEffort(effort: EffortLevel | null): void {
    if ((this.meta.effort ?? null) === effort) return;
    this.meta.effort = effort;
    this.hooks.onMeta(this.meta);
    void this.runner?.setEffort(effort);
    this.schedulePersist();
  }

  rename(title: string): void {
    const t = title.trim();
    if (!t || t === this.meta.title) return;
    this.meta.title = t;
    this.hooks.onMeta(this.meta);
    this.schedulePersist();
  }

  setArchived(archived: boolean): void {
    if (!!this.meta.archived === archived) return;
    this.meta.archived = archived || undefined;
    this.hooks.onMeta(this.meta);
    this.schedulePersist();
  }

  resolvePermission(requestId: string, decision: PermissionDecision): void {
    const entry = this.pending.get(requestId);

    // Find the event by requestId either way — the entry may be gone (server
    // restart, SDK aborted) while the event on disk is still "pending".
    // Without this, the UI sits forever waiting for a resolution that
    // silently never arrives.
    const event = entry
      ? entry.event
      : (this.events.find(
          (e) => e.kind === 'permission' && e.requestId === requestId,
        ) as PermissionEvent | undefined);

    if (!event) return; // truly unknown — nothing to do
    if (event.status !== 'pending') return; // already resolved, ignore late click

    if (entry) this.pending.delete(requestId);

    if (decision.behavior === 'allow') {
      event.status = 'allowed';
      event.resolution = 'Allowed';
    } else if (decision.behavior === 'answer') {
      // The user answered an elicitation (e.g. AskUserQuestion).
      event.status = 'allowed';
      event.resolution = 'Answered';
    } else {
      event.status = 'denied';
      event.resolution = `Denied — ${decision.message}`;
    }
    this.touch(event);

    // Only feed the SDK back if it's actually still waiting. Without a live
    // entry the SDK has long given up and there's nothing to resolve.
    if (entry) {
      this.setStatus('running');
      if (decision.behavior === 'allow') {
        entry.resolve({ behavior: 'allow', updatedInput: decision.updatedInput });
      } else if (decision.behavior === 'answer') {
        entry.resolve({ behavior: 'deny', message: decision.data });
      } else {
        entry.resolve({ behavior: 'deny', message: decision.message });
      }
    }
  }

  dispose(): void {
    this.failPending('Session closed.');
    this.runner?.stop();
    this.runner = null;
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    // Flush instead of dropping whatever the cancelled debounce was holding —
    // otherwise the newest ~400 ms of events (including the denials above)
    // are lost on every shutdown/reload.
    this.hooks.persist(this);
  }

  toPersisted(): PersistedSession {
    return { meta: this.meta, events: this.events };
  }

  // --- runner wiring --------------------------------------------------------

  private ensureRunner(): ClaudeRunner {
    if (this.runner) return this.runner;
    const runner = new ClaudeRunner({
      cwd: this.meta.cwd,
      model: this.meta.model,
      effort: this.meta.effort ?? null,
      permissionMode: this.meta.permissionMode,
      resumeSessionId: this.meta.claudeSessionId,
      // Read fresh each time a runner starts so MCP edits apply to new runs.
      mcpServers: readMcpServersSync(),
      // Same story for hooks — config edits take effect on the next runner spin-up.
      hooks: buildSdkHookOptions(readHooks()),
      plugins: readPlugins(),
      onEvent: (event) => this.handleRunnerEvent(event),
      onError: (err) => {
        this.add({ kind: 'system', text: `Error: ${errMessage(err)}` });
        this.setStatus('error');
      },
      onEnd: () => {
        this.runner = null;
        // The SDK promises behind any pending permissions died with the
        // runner — resolve them now or the session sits in
        // awaiting_permission forever and a later click on the stale card
        // flips it to a phantom "running".
        this.failPending('Claude process ended before this was answered.');
        if (this.meta.status === 'running' || this.meta.status === 'awaiting_permission') {
          this.setStatus('idle');
        }
      },
      onPermission: (toolName, input, suggestions) =>
        this.requestPermission(toolName, input, suggestions),
    });
    this.runner = runner;
    return runner;
  }

  private handleRunnerEvent(event: RunnerEvent): void {
    switch (event.kind) {
      case 'claude_session': {
        let changed = false;
        if (this.meta.claudeSessionId !== event.claudeSessionId) {
          this.meta.claudeSessionId = event.claudeSessionId;
          changed = true;
        }
        // Pin the actually-resolved model so the UI can show it explicitly
        // instead of a vague "default".
        if (event.model && this.meta.model !== event.model) {
          this.meta.model = event.model;
          changed = true;
        }
        if (!slashCommandsEqual(this.meta.slashCommands, event.slashCommands)) {
          this.meta.slashCommands = event.slashCommands;
          changed = true;
        }
        if (event.outputStyle && this.meta.outputStyle !== event.outputStyle) {
          this.meta.outputStyle = event.outputStyle;
          changed = true;
        }
        if (changed) this.hooks.onMeta(this.meta);
        break;
      }
      case 'slash_commands': {
        // The control-channel RPC came back — replace the name-only list
        // (seeded from the init message) with rich SlashCommand metadata.
        if (!slashCommandsEqual(this.meta.slashCommands, event.commands)) {
          this.meta.slashCommands = event.commands;
          this.hooks.onMeta(this.meta);
        }
        this.hooks.onSlashCommands(event.commands);
        break;
      }
      case 'models': {
        this.hooks.onModels(event.models);
        break;
      }
      case 'account': {
        this.hooks.onAccount(event.account);
        break;
      }
      case 'user_uuid': {
        // The SDK echoed our most recent user message with its assigned uuid;
        // walk back to find the latest user event without one and patch it,
        // so the timeline can offer "Rewind to here" on this turn.
        for (let i = this.events.length - 1; i >= 0; i--) {
          const e = this.events[i];
          if (e.kind === 'user' && !e.userUuid) {
            e.userUuid = event.uuid;
            this.touch(e);
            break;
          }
        }
        break;
      }
      case 'assistant':
        this.add({ kind: 'assistant', text: event.text });
        break;
      case 'assistant_partial':
        // Transient — straight to attached clients, never into the event log.
        this.hooks.onPartial(this.meta.id, event.text);
        break;
      case 'thinking':
        this.add({ kind: 'thinking', text: event.text });
        break;
      case 'tool_use': {
        // The SDK occasionally re-emits the same tool_use id when a permission
        // request aborts and the conversation later resumes — persisting both
        // wrecks the Anthropic API call ("tool_use ids must be unique" → 400).
        // Drop any second occurrence of the same id silently.
        const dup = this.events.some(
          (e) => e.kind === 'tool_use' && e.toolId === event.toolId,
        );
        if (dup) {
          console.warn(`[session] dropping duplicate tool_use id=${event.toolId}`);
          break;
        }
        this.add({ kind: 'tool_use', toolId: event.toolId, name: event.name, input: event.input });
        break;
      }
      case 'tool_result':
        this.add(
          event.images.length > 0
            ? {
                kind: 'tool_result',
                toolId: event.toolId,
                content: event.content,
                isError: event.isError,
                images: event.images,
              }
            : {
                kind: 'tool_result',
                toolId: event.toolId,
                content: event.content,
                isError: event.isError,
              },
        );
        break;
      case 'system':
        this.add({ kind: 'system', text: event.text });
        break;
      case 'compaction':
        this.add({
          kind: 'compaction',
          trigger: event.trigger,
          preTokens: event.preTokens,
        });
        break;
      case 'result': {
        // A turn the user just stopped reports an error-flavored result — that
        // is the abort working as intended, not a failure. Present it as a
        // clean stop so the session isn't badged "error" and no error push
        // notification fires.
        const interrupted = this.interrupting && event.isError;
        this.interrupting = false;
        const isError = interrupted ? false : event.isError;
        const text = interrupted ? 'Interrupted' : event.text;
        // The SDK told us the real context-window size for this session's
        // model — pin it so the UI's usage bar scales correctly.
        if (event.contextWindow && this.meta.contextWindow !== event.contextWindow) {
          this.meta.contextWindow = event.contextWindow;
          this.hooks.onMeta(this.meta);
        }
        this.add(
          event.tokens
            ? {
                kind: 'result',
                isError,
                durationMs: event.durationMs,
                costUsd: event.costUsd,
                tokens: event.tokens,
                text,
              }
            : {
                kind: 'result',
                isError,
                durationMs: event.durationMs,
                costUsd: event.costUsd,
                text,
              },
        );
        this.setStatus(isError ? 'error' : 'idle');
        // Turn boundary — flush now so the completed turn is on disk even if
        // the adaptive debounce below would have waited seconds.
        this.persistNow();
        break;
      }
    }
  }

  /** Deny every pending permission and mark its event resolved, so the SDK
   *  promise is released AND the UI card/modal stops showing "pending". */
  private failPending(message: string): void {
    for (const { resolve, event } of this.pending.values()) {
      resolve({ behavior: 'deny', message });
      if (event.status === 'pending') {
        event.status = 'denied';
        event.resolution = `Denied — ${message}`;
        this.touch(event);
      }
    }
    this.pending.clear();
  }

  private requestPermission(
    toolName: string,
    input: Record<string, unknown>,
    suggestions: unknown,
  ): Promise<PermissionOutcome> {
    const requestId = nanoid(10);
    const event = this.add({
      kind: 'permission',
      requestId,
      toolName,
      input,
      suggestions,
      status: 'pending',
      resolution: null,
    }) as PermissionEvent;
    this.setStatus('awaiting_permission');
    this.hooks.onPermission({ requestId, sessionId: this.meta.id, toolName, input, suggestions });
    return new Promise<PermissionOutcome>((resolve) => {
      this.pending.set(requestId, { resolve, event });
    });
  }

  // --- event log ------------------------------------------------------------

  private add(partial: NewEvent): SessionEvent {
    const event = { ...partial, seq: ++this.seq, ts: Date.now() } as SessionEvent;
    this.events.push(event);
    this.meta.eventCount = this.events.length;
    this.meta.lastActivity = event.ts;
    this.hooks.onEvent(this.meta.id, event);
    this.schedulePersist();
    return event;
  }

  /** Re-broadcast an event that was mutated in place (clients upsert by seq). */
  private touch(event: SessionEvent): void {
    this.meta.lastActivity = Date.now();
    this.hooks.onEvent(this.meta.id, event);
    this.schedulePersist();
  }

  private setStatus(status: SessionStatus): void {
    if (this.meta.status === status) return;
    this.meta.status = status;
    this.hooks.onMeta(this.meta);
    this.schedulePersist();
  }

  private schedulePersist(): void {
    if (this.persistTimer) return;
    // Every persist re-serializes the whole event log (base64 images
    // included), so the debounce scales with session size: short sessions
    // keep the snappy 400 ms, long image-heavy ones are capped at one
    // rewrite per 5 s. Turn end (persistNow) and dispose() flush promptly,
    // so the crash-loss window stays small where it matters.
    const delay = Math.min(5000, 400 + this.events.length * 2);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.hooks.persist(this);
    }, delay);
  }

  /** Cancel any pending debounce and persist immediately. */
  private persistNow(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.hooks.persist(this);
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function slashCommandsEqual(
  a: SlashCommand[] | undefined,
  b: SlashCommand[] | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].name !== b[i].name ||
      a[i].description !== b[i].description ||
      a[i].argumentHint !== b[i].argumentHint
    ) {
      return false;
    }
  }
  return true;
}
