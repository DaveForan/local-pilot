import { nanoid } from 'nanoid';
import { ClaudeRunner } from './claudeRunner';
import type { RunnerEvent, PermissionOutcome } from './claudeRunner';
import { readMcpServersSync } from './mcpConfig';
import type { PersistedSession } from './store';
import type {
  SessionMeta,
  SessionEvent,
  SessionStatus,
  PermissionMode,
  PermissionRequest,
  PermissionDecision,
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

  sendInput(text: string): void {
    if (this.meta.status === 'ended') return;
    this.add({ kind: 'user', text });
    this.setStatus('running');
    this.ensureRunner().send(text);
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

  resolvePermission(requestId: string, decision: PermissionDecision): void {
    const entry = this.pending.get(requestId);
    if (!entry) return;
    this.pending.delete(requestId);
    entry.event.status = decision.behavior === 'allow' ? 'allowed' : 'denied';
    entry.event.resolution =
      decision.behavior === 'allow' ? 'Allowed' : `Denied — ${decision.message}`;
    this.touch(entry.event);
    this.setStatus('running');
    entry.resolve(
      decision.behavior === 'allow'
        ? { behavior: 'allow', updatedInput: decision.updatedInput }
        : { behavior: 'deny', message: decision.message },
    );
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
      case 'claude_session':
        if (this.meta.claudeSessionId !== event.claudeSessionId) {
          this.meta.claudeSessionId = event.claudeSessionId;
          this.hooks.onMeta(this.meta);
        }
        break;
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
        this.add({
          kind: 'tool_result',
          toolId: event.toolId,
          content: event.content,
          isError: event.isError,
        });
        break;
      case 'system':
        this.add({ kind: 'system', text: event.text });
        break;
      case 'result':
        this.add({
          kind: 'result',
          isError: event.isError,
          durationMs: event.durationMs,
          costUsd: event.costUsd,
          text: event.text,
        });
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
