import { query } from '@anthropic-ai/claude-agent-sdk';
import type {
  PermissionMode,
  ChatImage,
  SlashCommand,
  ModelInfo,
  EffortLevel,
  McpServerStatus,
  AccountInfo,
} from './protocol';

// --- SDK boundary -----------------------------------------------------------
// The Agent SDK's exact TypeScript surface is verified separately. To keep the
// rest of the codebase decoupled from it, this file is the *only* place that
// touches the SDK: we drive `query` through a deliberately loose local
// signature and normalise its output into RunnerEvent values.

interface SDKUserMessage {
  type: 'user';
  message: { role: 'user'; content: string | unknown[] };
  parent_tool_use_id: string | null;
}

interface LooseQuery extends AsyncGenerator<Record<string, any>> {
  interrupt?: () => Promise<void>;
  setPermissionMode?: (mode: string) => Promise<void> | void;
  /** Change the model used for subsequent turns. `undefined` restores the
   *  CLI default. This is the SDK's sanctioned mid-session model switch. */
  setModel?: (model?: string) => Promise<void> | void;
  /** Merge a partial settings object into the session's flag-settings layer —
   *  the SDK's sanctioned way to change `effortLevel` (and more) mid-session.
   *  Streaming-input mode only. */
  applyFlagSettings?: (settings: Record<string, unknown>) => Promise<void> | void;
  close?: () => void;
  /** Control-channel RPC — returns rich metadata (description, argumentHint)
   *  for every available slash command. The init system message gives names
   *  only; this is where the descriptions actually come from. */
  supportedCommands?: () => Promise<
    Array<{ name: string; description: string; argumentHint: string }>
  >;
  /** Models available to this account — id, display name, description. */
  supportedModels?: () => Promise<
    Array<{ value: string; displayName: string; description: string }>
  >;
  /** Live connection status of every configured MCP server. */
  mcpServerStatus?: () => Promise<
    Array<{
      name: string;
      status: string;
      serverInfo?: { name: string; version: string };
    }>
  >;
  /** Email / org / subscription info for the authenticated account. */
  accountInfo?: () => Promise<AccountInfo>;
  /** Restore tracked files to their state at the given user-message uuid.
   *  Requires enableFileCheckpointing: true at start. */
  rewindFiles?: (
    userMessageId: string,
    options?: { dryRun?: boolean },
  ) => Promise<{
    canRewind: boolean;
    error?: string;
    filesChanged?: string[];
    insertions?: number;
    deletions?: number;
  }>;
}

const runQuery = query as unknown as (arg: {
  prompt: AsyncIterable<unknown>;
  options: Record<string, unknown>;
}) => LooseQuery;

// --- public types -----------------------------------------------------------

/** Normalised events emitted by the runner — the SDK shape never leaks past here. */
export type RunnerEvent =
  | { kind: 'assistant'; text: string }
  /** Live streaming text delta — transient, superseded by the full 'assistant'. */
  | { kind: 'assistant_partial'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool_use'; toolId: string; name: string; input: unknown }
  | {
      kind: 'tool_result';
      toolId: string;
      content: string;
      isError: boolean;
      images: ChatImage[];
    }
  | { kind: 'system'; text: string }
  | { kind: 'compaction'; trigger: 'auto' | 'manual'; preTokens: number }
  | {
      kind: 'result';
      isError: boolean;
      durationMs: number | null;
      costUsd: number | null;
      tokens?: {
        input: number;
        output: number;
        cacheRead: number;
        cacheCreate: number;
      };
      /** Context-window size (tokens) the SDK reported for the turn's model. */
      contextWindow?: number;
      text: string;
    }
  | {
      kind: 'claude_session';
      claudeSessionId: string;
      model: string | null;
      /** Slash commands the SDK exposes for this session (e.g. /help, /clear).
       *  At init we only have names — descriptions arrive via the follow-up
       *  `slash_commands` event once the control-channel RPC resolves. */
      slashCommands: SlashCommand[];
      /** Active output style at init time. */
      outputStyle: string | null;
    }
  | { kind: 'slash_commands'; commands: SlashCommand[] }
  | { kind: 'models'; models: ModelInfo[] }
  | { kind: 'account'; account: AccountInfo }
  /** SDK echoed back a user message — carries the uuid we need to rewind to. */
  | { kind: 'user_uuid'; uuid: string };

/** Result of a rewindFiles() call — mirrors the SDK's RewindFilesResult. */
export interface RewindResult {
  canRewind: boolean;
  error?: string;
  filesChanged?: string[];
  insertions?: number;
  deletions?: number;
}

export interface PermissionOutcome {
  behavior: 'allow' | 'deny';
  updatedInput?: Record<string, unknown>;
  message?: string;
}

export interface RunnerOptions {
  cwd: string;
  model: string | null;
  /** Reasoning effort to start the session at. null = the model's default. */
  effort: EffortLevel | null;
  permissionMode: PermissionMode;
  /** Claude Code session id to resume (after a server restart); null for fresh. */
  resumeSessionId: string | null;
  /** MCP servers local-pilot layers onto this session (may be empty). */
  mcpServers: Record<string, unknown>;
  /** SDK-shaped hooks option, or null when the user has none configured. */
  hooks: Record<string, unknown> | null;
  /** Local plugin entries to load alongside MCP servers and hooks. */
  plugins: Array<{ type: 'local'; path: string }>;
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

  /** Remove and return everything still queued (i.e. never consumed). */
  drain(): T[] {
    const items = this.items;
    this.items = [];
    return items;
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
  /** Don't issue the supportedCommands RPC more than once per runner. */
  private commandsFetched = false;

  constructor(opts: RunnerOptions) {
    this.opts = opts;
  }

  /** Queue a user message; lazily starts the underlying query on first send. */
  send(text: string, images: ChatImage[] = []): void {
    if (this.stopped) return;
    // With images the SDK expects a content-block array, not a bare string.
    const content =
      images.length > 0
        ? [
            ...images.map((im) => ({
              type: 'image',
              source: { type: 'base64', media_type: im.mediaType, data: im.data },
            })),
            ...(text ? [{ type: 'text', text }] : []),
          ]
        : text;
    this.queue.push({
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
    });
    if (!this.started) this.start();
  }

  private start(): void {
    this.started = true;
    const options: Record<string, unknown> = {
      cwd: this.opts.cwd,
      permissionMode: this.opts.permissionMode,
      // The SDK requires this safety flag when running in bypassPermissions
      // mode — without it, the SDK refuses to start. Our canUseTool also
      // honors the mode, so the two layers agree.
      allowDangerouslySkipPermissions:
        this.opts.permissionMode === 'bypassPermissions',
      // Run with the real Claude Code system prompt + load the user's
      // ~/.claude config, project settings, CLAUDE.md and MCP servers.
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      settingSources: ['user', 'project', 'local'],
      // Snapshot files before each modification so the user can rewind the
      // workspace back to the state at any prior turn via rewindFiles().
      enableFileCheckpointing: true,
      // Stream token deltas so replies render live instead of landing as one
      // block at the end of the turn.
      includePartialMessages: true,
      canUseTool: async (toolName: string, input: Record<string, unknown>, extra: any) => {
        // TodoWrite is tracking-only (no filesystem / no exec); auto-allow so
        // the user isn't pestered every time Claude updates the task list.
        if (toolName === 'TodoWrite') {
          return { behavior: 'allow', updatedInput: input };
        }
        // AskUserQuestion is not a risky action to gate — it's Claude asking the
        // user for input, and the answer is delivered back through this same
        // canUseTool result. Auto-allowing it (as bypassPermissions otherwise
        // would) means no answer is ever injected and the SDK treats the
        // question as dismissed. So it must always reach the user, whatever the
        // permission mode.
        const isElicitation = ELICITATION_TOOLS.has(toolName);
        // Honor the current permissionMode here — without this, providing
        // canUseTool would override the SDK's mode-based auto-allow and the
        // user would still get prompted on every tool even with acceptEdits
        // or bypassPermissions selected.
        const mode = this.opts.permissionMode;
        if (!isElicitation) {
          if (mode === 'bypassPermissions') {
            return { behavior: 'allow', updatedInput: input };
          }
          if (mode === 'acceptEdits' && EDIT_TOOLS.has(toolName)) {
            return { behavior: 'allow', updatedInput: input };
          }
        }
        const outcome = await this.opts.onPermission(toolName, input, extra?.suggestions);
        // `updatedInput` is required on an allow result — it is the input the
        // tool actually runs with (unchanged here unless the UI edited it).
        return outcome.behavior === 'allow'
          ? { behavior: 'allow', updatedInput: outcome.updatedInput ?? input }
          : { behavior: 'deny', message: outcome.message ?? 'Denied by user.' };
      },
    };
    if (this.opts.model) options.model = this.opts.model;
    // `effort` accepts the full range (low..max) at session start, unlike the
    // mid-session applyFlagSettings path which the SDK types narrower.
    if (this.opts.effort) options.effort = this.opts.effort;
    if (this.opts.resumeSessionId) options.resume = this.opts.resumeSessionId;
    if (Object.keys(this.opts.mcpServers).length > 0) {
      options.mcpServers = this.opts.mcpServers;
    }
    if (this.opts.hooks) options.hooks = this.opts.hooks;
    if (this.opts.plugins.length > 0) options.plugins = this.opts.plugins;

    try {
      this.generator = runQuery({ prompt: this.queue, options });
      void this.pump(this.generator);
    } catch (err) {
      // Without onEnd() the Session keeps handing input to this zombie
      // (started=true, no generator) and sticks in "running" forever.
      this.stopped = true;
      this.generator = null;
      this.opts.onError(err);
      this.opts.onEnd();
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
      // Messages queued behind the current turn die with the runner, but the
      // UI already shows them as sent — say so, or the user believes Claude
      // saw something it never did.
      const undelivered = this.queue.drain();
      if (undelivered.length > 0 && !this.stopped) {
        this.opts.onEvent({
          kind: 'system',
          text:
            `${undelivered.length} queued message${undelivered.length === 1 ? ' was' : 's were'} ` +
            'never delivered — the Claude process ended first. Please resend.',
        });
      }
      this.opts.onEnd();
    }
  }

  /** Translate one raw SDK message into zero or more RunnerEvents. */
  private handle(msg: Record<string, any>): void {
    switch (msg.type) {
      case 'system': {
        if (msg.subtype === 'init') {
          if (msg.session_id) {
            const names = Array.isArray(msg.slash_commands)
              ? (msg.slash_commands as string[]).filter((s) => typeof s === 'string')
              : [];
            this.opts.onEvent({
              kind: 'claude_session',
              claudeSessionId: msg.session_id,
              model: typeof msg.model === 'string' ? msg.model : null,
              slashCommands: names.map((name) => ({
                name,
                description: '',
                argumentHint: '',
              })),
              outputStyle: typeof msg.output_style === 'string' ? msg.output_style : null,
            });
            // Once we've seen init, fetch control-channel metadata
            // (slash command descriptions, available models).
            void this.fetchControlMetadata();
          }
          this.opts.onEvent({
            kind: 'system',
            text: `Session ready · model ${msg.model ?? 'default'}`,
          });
        } else if (msg.subtype === 'compact_boundary') {
          // The SDK just summarized older history to free up context. The
          // metadata tells us whether it was auto- or user-triggered and how
          // much was in the window beforehand.
          const meta = msg.compact_metadata as
            | { trigger?: string; pre_tokens?: number }
            | undefined;
          const trigger = meta?.trigger === 'manual' ? 'manual' : 'auto';
          const preTokens = Number(meta?.pre_tokens ?? 0) || 0;
          this.opts.onEvent({ kind: 'compaction', trigger, preTokens });
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
        // The SDK echoes back every user message with its assigned uuid —
        // we capture that so the UI can later pass it to rewindFiles().
        // Tool-result blocks (when a tool's output is delivered as a "user"
        // turn) are also extracted here.
        if (typeof msg.uuid === 'string' && msg.uuid) {
          this.opts.onEvent({ kind: 'user_uuid', uuid: msg.uuid });
        }
        const content = msg.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_result') {
              this.opts.onEvent({
                kind: 'tool_result',
                toolId: block.tool_use_id,
                content: stringifyContent(block.content),
                isError: block.is_error === true,
                images: extractImages(block.content),
              });
            }
          }
        }
        break;
      }
      case 'stream_event': {
        // Live token deltas (includePartialMessages). Main thread only —
        // subagent streams carry a parent_tool_use_id.
        if (msg.parent_tool_use_id) break;
        const ev = msg.event as Record<string, any> | undefined;
        if (ev?.type === 'content_block_delta') {
          const delta = ev.delta as Record<string, any> | undefined;
          if (delta?.type === 'text_delta' && typeof delta.text === 'string' && delta.text) {
            this.opts.onEvent({ kind: 'assistant_partial', text: delta.text });
          }
        }
        break;
      }
      case 'result': {
        const ok = msg.subtype === 'success' && msg.is_error !== true;
        // The SDK reports a `usage` block (input/output/cache tokens) and a
        // `total_cost_usd` it computed from those tokens × current model
        // prices. We surface both so the UI can show the math, not just the
        // total. The 'cache_*_input_tokens' field names mirror Anthropic's
        // API exactly.
        const usage = msg.usage as Record<string, unknown> | undefined;
        const tokens = usage
          ? {
              input: Number(usage.input_tokens ?? 0) || 0,
              output: Number(usage.output_tokens ?? 0) || 0,
              cacheRead: Number(usage.cache_read_input_tokens ?? 0) || 0,
              cacheCreate: Number(usage.cache_creation_input_tokens ?? 0) || 0,
            }
          : undefined;
        // modelUsage carries the real per-model context-window size — the only
        // way to know it (incl. 1M-beta windows) without hardcoding a table.
        const modelUsage = msg.modelUsage as
          | Record<string, { contextWindow?: number }>
          | undefined;
        let contextWindow: number | undefined;
        if (modelUsage) {
          for (const m of Object.values(modelUsage)) {
            if (typeof m?.contextWindow === 'number' && m.contextWindow > 0) {
              contextWindow = Math.max(contextWindow ?? 0, m.contextWindow);
            }
          }
        }
        this.opts.onEvent({
          kind: 'result',
          isError: !ok,
          durationMs: typeof msg.duration_ms === 'number' ? msg.duration_ms : null,
          costUsd: typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : null,
          tokens,
          contextWindow,
          text: ok ? 'Turn complete' : `Turn ended: ${msg.subtype ?? 'error'}`,
        });
        break;
      }
      default: {
        // Anything unrecognized (including any future elicitation /
        // MCP-elicitation messages) gets logged so it's diagnosable instead
        // of silently dropped.
        if (msg.type) {
          console.warn(`[runner] unhandled SDK message type: ${msg.type}`);
        }
        break;
      }
    }
  }

  /** Ask the SDK for control-channel metadata (slash command descriptions,
   *  available models) once per runner, right after init. Best-effort —
   *  failures fall back to the name-only / hardcoded lists. */
  private async fetchControlMetadata(): Promise<void> {
    if (this.commandsFetched || this.stopped) return;
    this.commandsFetched = true;
    const gen = this.generator;
    if (!gen) return;

    if (typeof gen.supportedCommands === 'function') {
      try {
        const commands = normalizeCommands(await gen.supportedCommands());
        if (!this.stopped) this.opts.onEvent({ kind: 'slash_commands', commands });
      } catch (err) {
        console.warn('[runner] supportedCommands failed:', err);
      }
    }

    if (typeof gen.supportedModels === 'function') {
      try {
        const models = normalizeModels(await gen.supportedModels());
        if (!this.stopped) this.opts.onEvent({ kind: 'models', models });
      } catch (err) {
        console.warn('[runner] supportedModels failed:', err);
      }
    }

    if (typeof gen.accountInfo === 'function') {
      try {
        const info = await gen.accountInfo();
        if (!this.stopped && info && typeof info === 'object') {
          this.opts.onEvent({ kind: 'account', account: info });
        }
      } catch (err) {
        console.warn('[runner] accountInfo failed:', err);
      }
    }
  }

  /** Snapshot the connection state of every MCP server the SDK has loaded.
   *  Returns null when the SDK has no live connection (no runner yet, etc). */
  async mcpServerStatus(): Promise<McpServerStatus[] | null> {
    const gen = this.generator;
    if (!gen || typeof gen.mcpServerStatus !== 'function') return null;
    try {
      const list = await gen.mcpServerStatus();
      if (!Array.isArray(list)) return null;
      return list
        .filter((s) => s && typeof s.name === 'string')
        .map((s) => ({
          name: s.name,
          status: normalizeMcpStatus(s.status),
          serverInfo: s.serverInfo,
        }));
    } catch (err) {
      console.warn('[runner] mcpServerStatus failed:', err);
      return null;
    }
  }

  /** Restore files to their state at the given user message. dryRun previews
   *  the change without modifying the workspace. */
  async rewindFiles(userUuid: string, dryRun: boolean): Promise<RewindResult> {
    const gen = this.generator;
    if (!gen || typeof gen.rewindFiles !== 'function') {
      return { canRewind: false, error: 'Rewind not supported by this SDK build.' };
    }
    try {
      const result = await gen.rewindFiles(userUuid, { dryRun });
      return {
        canRewind: !!result.canRewind,
        error: result.error,
        filesChanged: result.filesChanged,
        insertions: result.insertions,
        deletions: result.deletions,
      };
    } catch (err) {
      return { canRewind: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async setMode(mode: PermissionMode): Promise<void> {
    // Track the current mode locally so canUseTool can consult it on every
    // tool call — without this, mode changes only take effect on the next
    // runner spin-up.
    this.opts.permissionMode = mode;
    try {
      if (this.generator && typeof this.generator.setPermissionMode === 'function') {
        await this.generator.setPermissionMode(mode);
      }
    } catch (err) {
      console.error('[runner] setMode failed:', err);
    }
  }

  /** Switch the model on a live session via the SDK control channel. Pass null
   *  to fall back to the CLI default. No-op (beyond the caller updating meta)
   *  when no runner has started yet — the next start() picks up the new model. */
  async setModel(model: string | null): Promise<void> {
    this.opts.model = model;
    try {
      if (this.generator && typeof this.generator.setModel === 'function') {
        await this.generator.setModel(model ?? undefined);
      }
    } catch (err) {
      console.error('[runner] setModel failed:', err);
    }
  }

  /** Change reasoning effort on a live session via applyFlagSettings. `null`
   *  clears it back to the model default. Persisted in opts so a restarted
   *  runner re-applies it through Options.effort. */
  async setEffort(effort: EffortLevel | null): Promise<void> {
    this.opts.effort = effort;
    try {
      if (this.generator && typeof this.generator.applyFlagSettings === 'function') {
        // `null` clears the flag layer (falls back to lower-precedence sources).
        await this.generator.applyFlagSettings({ effortLevel: effort });
      }
    } catch (err) {
      console.error('[runner] setEffort failed:', err);
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

/** What a one-shot discovery probe learns from the SDK control channel. */
export interface DiscoveryResult {
  models: ModelInfo[];
  slashCommands: SlashCommand[];
}

/**
 * Spin up a throwaway Agent SDK `query` purely to read the account's model
 * catalog and slash-command list over the control channel, then tear it down.
 *
 * The interactive runner only learns these *after* a session's `init` message,
 * which means the New Session dialog has nothing real to show until the user
 * has already created a session. This probe closes that gap: the SDK is the
 * source of truth for which models the account can actually use (incl. newer
 * Opus releases), so we ask it up front instead of hardcoding a list.
 */
export async function discover(
  cwd: string,
  timeoutMs = 20_000,
): Promise<DiscoveryResult> {
  const queue = new MessageQueue<SDKUserMessage>();
  const options: Record<string, unknown> = {
    cwd,
    // Match the interactive runner so slash commands reflect the user's real
    // ~/.claude + project config, not a bare default environment.
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    settingSources: ['user', 'project', 'local'],
  };

  let gen: LooseQuery;
  try {
    gen = runQuery({ prompt: queue, options });
  } catch (err) {
    console.warn('[discover] failed to start probe query:', err);
    return { models: [], slashCommands: [] };
  }

  // The control channel only advances while the generator is being consumed,
  // so drain it in the background and discard every message.
  let draining = true;
  void (async () => {
    try {
      for await (const _msg of gen) {
        if (!draining) break;
      }
    } catch {
      /* torn down in finally below */
    }
  })();

  const withTimeout = <T>(p: Promise<T>, fallback: T): Promise<T> =>
    Promise.race([
      Promise.resolve(p).catch(() => fallback),
      new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
    ]);

  try {
    const [rawModels, rawCommands] = await Promise.all([
      typeof gen.supportedModels === 'function'
        ? withTimeout(gen.supportedModels(), [] as Array<Record<string, unknown>>)
        : Promise.resolve([] as Array<Record<string, unknown>>),
      typeof gen.supportedCommands === 'function'
        ? withTimeout(gen.supportedCommands(), [] as Array<Record<string, unknown>>)
        : Promise.resolve([] as Array<Record<string, unknown>>),
    ]);
    return {
      models: normalizeModels(rawModels),
      slashCommands: normalizeCommands(rawCommands),
    };
  } finally {
    draining = false;
    queue.close();
    try {
      gen.close?.();
    } catch {
      /* ignore */
    }
  }
}

const EFFORT_LEVELS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** Coerce the SDK's loosely-typed model list into ModelInfo values, preserving
 *  the per-model effort capability the SDK reports. */
function normalizeModels(list: unknown): ModelInfo[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((m): m is Record<string, unknown> => !!m && typeof (m as any).value === 'string')
    .map((m) => {
      const levels = Array.isArray(m.supportedEffortLevels)
        ? (m.supportedEffortLevels as unknown[]).filter(
            (l): l is EffortLevel => typeof l === 'string' && EFFORT_LEVELS.includes(l as EffortLevel),
          )
        : undefined;
      return {
        value: m.value as string,
        displayName: typeof m.displayName === 'string' ? m.displayName : (m.value as string),
        description: typeof m.description === 'string' ? m.description : '',
        ...(typeof m.supportsEffort === 'boolean' ? { supportsEffort: m.supportsEffort } : {}),
        ...(levels ? { supportedEffortLevels: levels } : {}),
      };
    });
}

/** Coerce the SDK's loosely-typed command list into SlashCommand values. */
function normalizeCommands(list: unknown): SlashCommand[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((c): c is Record<string, unknown> => !!c && typeof (c as any).name === 'string')
    .map((c) => ({
      name: c.name as string,
      description: typeof c.description === 'string' ? c.description : '',
      argumentHint: typeof c.argumentHint === 'string' ? c.argumentHint : '',
    }));
}

/** Tools that count as edits for the acceptEdits permission mode. */
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/** Tools that ask the user for input rather than performing an action. These
 *  must always be routed to the user (never auto-allowed by permission mode),
 *  because the user's answer is delivered back through the canUseTool result. */
const ELICITATION_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);

function normalizeMcpStatus(s: unknown): McpServerStatus['status'] {
  if (s === 'connected' || s === 'failed' || s === 'needs-auth' || s === 'pending') return s;
  return 'unknown';
}

/** Tool results may be a string or an array of content blocks — flatten to text. */
function stringifyContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b: any) => {
        if (typeof b === 'string') return b;
        if (b?.type === 'text') return b.text;
        if (b?.type === 'image') return '[image]';
        return JSON.stringify(b);
      })
      .join('\n');
  }
  if (content == null) return '';
  return JSON.stringify(content, null, 2);
}

/** Pull base64 image blocks out of a tool result (e.g. screenshots). */
function extractImages(content: unknown): ChatImage[] {
  if (!Array.isArray(content)) return [];
  const out: ChatImage[] = [];
  for (const b of content as any[]) {
    if (b?.type === 'image' && b.source?.type === 'base64' && typeof b.source.data === 'string') {
      out.push({
        mediaType: typeof b.source.media_type === 'string' ? b.source.media_type : 'image/png',
        data: b.source.data,
      });
    }
  }
  return out;
}
