import { nanoid } from 'nanoid';
import { ClaudeRunner } from './claudeRunner';
import type { RunnerEvent, PermissionOutcome, RewindResult } from './claudeRunner';
import { readMcpServersSync } from './mcpConfig';
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
  onMeta(meta: SessionMeta): void;
  onPermission(request: PermissionRequest): void;
  persist(session: Session): void;
  /** Cache the account-wide model list any session learns about. */
  onModels(models: ModelInfo[]): void;
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
  private readonly pending = new Map<
    string,
    { resolve: (o: PermissionOutcome) => void; event: PermissionEvent }
  >();

  constructor(meta: SessionMeta, events: SessionEvent[], hooks: SessionHooks) {
    this.meta = meta;
    this.events = events;
    this.hooks = hooks;
    this.seq = events.reduce((max, e) => Math.max(max, e.seq), 0);
  }

  // --- input ----------------------------------------------------------------

  sendInput(text: string, images?: ChatImage[]): void {
    if (this.meta.status === 'ended') return;
    this.add(images && images.length > 0 ? { kind: 'user', text, images } : { kind: 'user', text });
    this.setStatus('running');
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
    if (this.runner) await this.runner.interrupt();
    for (const { resolve } of this.pending.values()) {
      resolve({ behavior: 'deny', message: 'Interrupted.' });
    }
    this.pending.clear();
    this.setStatus('idle');
  }

  setMode(mode: PermissionMode): void {
    this.meta.permissionMode = mode;
    this.hooks.onMeta(this.meta);
    void this.runner?.setMode(mode);
    this.schedulePersist();
  }

  rename(title: string): void {
    const t = title.trim();
    if (!t || t === this.meta.title) return;
    this.meta.title = t;
    this.hooks.onMeta(this.meta);
    this.schedulePersist();
  }

  resolvePermission(requestId: string, decision: PermissionDecision): void {
    const entry = this.pending.get(requestId);
    if (!entry) return;
    this.pending.delete(requestId);

    if (decision.behavior === 'allow') {
      entry.event.status = 'allowed';
      entry.event.resolution = 'Allowed';
    } else if (decision.behavior === 'answer') {
      // The user answered an elicitation (e.g. AskUserQuestion).
      entry.event.status = 'allowed';
      entry.event.resolution = 'Answered';
    } else {
      entry.event.status = 'denied';
      entry.event.resolution = `Denied — ${decision.message}`;
    }
    this.touch(entry.event);
    this.setStatus('running');

    // The SDK only understands allow/deny. For 'answer', we deliver the
    // structured response as the tool result via deny.message.
    if (decision.behavior === 'allow') {
      entry.resolve({ behavior: 'allow', updatedInput: decision.updatedInput });
    } else if (decision.behavior === 'answer') {
      entry.resolve({ behavior: 'deny', message: decision.data });
    } else {
      entry.resolve({ behavior: 'deny', message: decision.message });
    }
  }

  dispose(): void {
    for (const { resolve } of this.pending.values()) {
      resolve({ behavior: 'deny', message: 'Session closed.' });
    }
    this.pending.clear();
    this.runner?.stop();
    this.runner = null;
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
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
      permissionMode: this.meta.permissionMode,
      resumeSessionId: this.meta.claudeSessionId,
      // Read fresh each time a runner starts so MCP edits apply to new runs.
      mcpServers: readMcpServersSync(),
      onEvent: (event) => this.handleRunnerEvent(event),
      onError: (err) => {
        this.add({ kind: 'system', text: `Error: ${errMessage(err)}` });
        this.setStatus('error');
      },
      onEnd: () => {
        this.runner = null;
        if (this.meta.status === 'running') this.setStatus('idle');
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
      case 'thinking':
        this.add({ kind: 'thinking', text: event.text });
        break;
      case 'tool_use':
        this.add({ kind: 'tool_use', toolId: event.toolId, name: event.name, input: event.input });
        break;
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
      case 'result':
        this.add(
          event.tokens
            ? {
                kind: 'result',
                isError: event.isError,
                durationMs: event.durationMs,
                costUsd: event.costUsd,
                tokens: event.tokens,
                text: event.text,
              }
            : {
                kind: 'result',
                isError: event.isError,
                durationMs: event.durationMs,
                costUsd: event.costUsd,
                text: event.text,
              },
        );
        this.setStatus(event.isError ? 'error' : 'idle');
        break;
    }
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
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.hooks.persist(this);
    }, 400);
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
