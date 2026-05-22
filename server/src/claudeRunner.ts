import { query } from '@anthropic-ai/claude-agent-sdk';
import type { PermissionMode } from './protocol';

// --- SDK boundary -----------------------------------------------------------
// The Agent SDK's exact TypeScript surface is verified separately. To keep the
// rest of the codebase decoupled from it, this file is the *only* place that
// touches the SDK: we drive `query` through a deliberately loose local
// signature and normalise its output into RunnerEvent values.

interface SDKUserMessage {
  type: 'user';
  message: { role: 'user'; content: string };
  parent_tool_use_id: string | null;
}

interface LooseQuery extends AsyncGenerator<Record<string, any>> {
  interrupt?: () => Promise<void>;
  setPermissionMode?: (mode: string) => Promise<void> | void;
  close?: () => void;
}

const runQuery = query as unknown as (arg: {
  prompt: AsyncIterable<unknown>;
  options: Record<string, unknown>;
}) => LooseQuery;

// --- public types -----------------------------------------------------------

/** Normalised events emitted by the runner — the SDK shape never leaks past here. */
export type RunnerEvent =
  | { kind: 'assistant'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool_use'; toolId: string; name: string; input: unknown }
  | { kind: 'tool_result'; toolId: string; content: string; isError: boolean }
  | { kind: 'system'; text: string }
  | {
      kind: 'result';
      isError: boolean;
      durationMs: number | null;
      costUsd: number | null;
      text: string;
    }
  | { kind: 'claude_session'; claudeSessionId: string };

export interface PermissionOutcome {
  behavior: 'allow' | 'deny';
  updatedInput?: Record<string, unknown>;
  message?: string;
}

export interface RunnerOptions {
  cwd: string;
  model: string | null;
  permissionMode: PermissionMode;
  /** Claude Code session id to resume (after a server restart); null for fresh. */
  resumeSessionId: string | null;
  /** MCP servers local-pilot layers onto this session (may be empty). */
  mcpServers: Record<string, unknown>;
  onEvent: (event: RunnerEvent) => void;
  onError: (err: unknown) => void;
  onEnd: () => void;
  onPermission: (
    toolName: string,
    input: Record<string, unknown>,
    suggestions: unknown,
  ) => Promise<PermissionOutcome>;
}

// --- a push-driven async iterable used as the SDK's streaming `prompt` -------

class MessageQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiters: Array<(r: IteratorResult<T>) => void> = [];
  private closed = false;

  push(item: T): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: item, done: false });
    else this.items.push(item);
  }

  close(): void {
    this.closed = true;
    let w: ((r: IteratorResult<T>) => void) | undefined;
    while ((w = this.waiters.shift())) w({ value: undefined as never, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        const item = this.items.shift();
        if (item !== undefined) return Promise.resolve({ value: item, done: false });
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

// --- the runner -------------------------------------------------------------

/**
 * Wraps one long-lived Agent SDK `query` in streaming-input mode: the query
 * stays alive across many user turns; new turns are fed in via `send()`.
 */
export class ClaudeRunner {
  private readonly queue = new MessageQueue<SDKUserMessage>();
  private readonly opts: RunnerOptions;
  private generator: LooseQuery | null = null;
  private started = false;
  private stopped = false;

  constructor(opts: RunnerOptions) {
    this.opts = opts;
  }

  /** Queue a user message; lazily starts the underlying query on first send. */
  send(text: string): void {
    if (this.stopped) return;
    this.queue.push({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
    });
    if (!this.started) this.start();
  }

  private start(): void {
    this.started = true;
    const options: Record<string, unknown> = {
      cwd: this.opts.cwd,
      permissionMode: this.opts.permissionMode,
      // Run with the real Claude Code system prompt + load the user's
      // ~/.claude config, project settings, CLAUDE.md and MCP servers.
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      settingSources: ['user', 'project', 'local'],
      canUseTool: async (toolName: string, input: Record<string, unknown>, extra: any) => {
        const outcome = await this.opts.onPermission(toolName, input, extra?.suggestions);
        // `updatedInput` is required on an allow result — it is the input the
        // tool actually runs with (unchanged here unless the UI edited it).
        return outcome.behavior === 'allow'
          ? { behavior: 'allow', updatedInput: outcome.updatedInput ?? input }
          : { behavior: 'deny', message: outcome.message ?? 'Denied by user.' };
      },
    };
    if (this.opts.model) options.model = this.opts.model;
    if (this.opts.resumeSessionId) options.resume = this.opts.resumeSessionId;
    if (Object.keys(this.opts.mcpServers).length > 0) {
      options.mcpServers = this.opts.mcpServers;
    }

    try {
      this.generator = runQuery({ prompt: this.queue, options });
      void this.pump(this.generator);
    } catch (err) {
      this.opts.onError(err);
    }
  }

  private async pump(gen: LooseQuery): Promise<void> {
    try {
      for await (const msg of gen) {
        if (this.stopped) break;
        this.handle(msg);
      }
    } catch (err) {
      if (!this.stopped) this.opts.onError(err);
    } finally {
      this.opts.onEnd();
    }
  }

  /** Translate one raw SDK message into zero or more RunnerEvents. */
  private handle(msg: Record<string, any>): void {
    switch (msg.type) {
      case 'system': {
        if (msg.subtype === 'init') {
          if (msg.session_id) {
            this.opts.onEvent({ kind: 'claude_session', claudeSessionId: msg.session_id });
          }
          this.opts.onEvent({
            kind: 'system',
            text: `Session ready · model ${msg.model ?? 'default'}`,
          });
        }
        break;
      }
      case 'assistant': {
        for (const block of msg.message?.content ?? []) {
          if (block.type === 'text' && block.text) {
            this.opts.onEvent({ kind: 'assistant', text: block.text });
          } else if (block.type === 'thinking' && block.thinking) {
            this.opts.onEvent({ kind: 'thinking', text: block.thinking });
          } else if (block.type === 'tool_use') {
            this.opts.onEvent({
              kind: 'tool_use',
              toolId: block.id,
              name: block.name,
              input: block.input,
            });
          }
        }
        break;
      }
      case 'user': {
        const content = msg.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_result') {
              this.opts.onEvent({
                kind: 'tool_result',
                toolId: block.tool_use_id,
                content: stringifyContent(block.content),
                isError: block.is_error === true,
              });
            }
          }
        }
        break;
      }
      case 'result': {
        const ok = msg.subtype === 'success' && msg.is_error !== true;
        this.opts.onEvent({
          kind: 'result',
          isError: !ok,
          durationMs: typeof msg.duration_ms === 'number' ? msg.duration_ms : null,
          costUsd: typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : null,
          text: ok ? 'Turn complete' : `Turn ended: ${msg.subtype ?? 'error'}`,
        });
        break;
      }
    }
  }

  async setMode(mode: PermissionMode): Promise<void> {
    try {
      if (this.generator && typeof this.generator.setPermissionMode === 'function') {
        await this.generator.setPermissionMode(mode);
      }
    } catch (err) {
      console.error('[runner] setMode failed:', err);
    }
  }

  async interrupt(): Promise<void> {
    try {
      if (this.generator && typeof this.generator.interrupt === 'function') {
        await this.generator.interrupt();
      }
    } catch (err) {
      console.error('[runner] interrupt failed:', err);
    }
  }

  stop(): void {
    this.stopped = true;
    this.queue.close();
    void this.interrupt();
    try {
      this.generator?.close?.();
    } catch (err) {
      console.error('[runner] close failed:', err);
    }
  }
}

/** Tool results may be a string or an array of content blocks — flatten to text. */
function stringifyContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b: any) =>
        b?.type === 'text' ? b.text : typeof b === 'string' ? b : JSON.stringify(b),
      )
      .join('\n');
  }
  if (content == null) return '';
  return JSON.stringify(content, null, 2);
}
