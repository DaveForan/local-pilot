// Shared wire protocol between the local-pilot server and web client.
// This file is kept byte-identical with server/src/protocol.ts — edit both.

export type SessionStatus =
  | 'idle' // ready for input, nothing running
  | 'running' // a Claude turn is in progress
  | 'awaiting_permission' // blocked on a permission/elicitation decision
  | 'error'
  | 'ended';

export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

export interface SessionMeta {
  id: string;
  title: string;
  cwd: string;
  model: string | null;
  permissionMode: PermissionMode;
  status: SessionStatus;
  createdAt: number;
  lastActivity: number;
  eventCount: number;
  /** Underlying Claude Code session id — used to resume after a server restart. */
  claudeSessionId: string | null;
  /** Soft-deleted from the main session list — hidden by default, viewable
   *  via the "Show archived" toggle, restorable via Unarchive. */
  archived?: boolean;
  /** Slash commands the SDK exposes for this session (populated after init).
   *  Names come from the init message; description + argumentHint are
   *  enriched once the control-channel `supportedCommands()` RPC resolves. */
  slashCommands?: SlashCommand[];
  /** Currently active output style (e.g. "default"). The SDK has no setter
   *  via the runtime API — change it with the /output-style slash command. */
  outputStyle?: string;
}

/** Metadata for one slash command — matches the SDK's `SlashCommand` shape. */
export interface SlashCommand {
  name: string;
  description: string;
  argumentHint: string;
}

/** A model the account has access to — matches the SDK's `ModelInfo` shape. */
export interface ModelInfo {
  value: string;
  displayName: string;
  description: string;
}

/** Authenticated account info, as reported by the SDK. */
export interface AccountInfo {
  email?: string;
  organization?: string;
  subscriptionType?: string;
  tokenSource?: string;
  apiKeySource?: string;
}

/** Live status of one MCP server connection. */
export interface McpServerStatus {
  name: string;
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'unknown';
  serverInfo?: { name: string; version: string };
}

/** Result of a rewindFiles() call. */
export interface RewindResult {
  canRewind: boolean;
  error?: string;
  filesChanged?: string[];
  insertions?: number;
  deletions?: number;
}

/** A base64-encoded image — attached by the user, or produced by a tool. */
export interface ChatImage {
  mediaType: string;
  /** base64 image bytes, with no data: URL prefix. */
  data: string;
}

/** A single entry in a session's rendered timeline. */
export type SessionEvent =
  | {
      seq: number;
      ts: number;
      kind: 'user';
      text: string;
      images?: ChatImage[];
      /** SDK-assigned uuid for this user message — required to rewind to it. */
      userUuid?: string;
    }
  | { seq: number; ts: number; kind: 'assistant'; text: string }
  | { seq: number; ts: number; kind: 'thinking'; text: string }
  | { seq: number; ts: number; kind: 'tool_use'; toolId: string; name: string; input: unknown }
  | {
      seq: number;
      ts: number;
      kind: 'tool_result';
      toolId: string;
      content: string;
      isError: boolean;
      /** Images produced by the tool (e.g. screenshots). */
      images?: ChatImage[];
    }
  | { seq: number; ts: number; kind: 'system'; text: string }
  | {
      seq: number;
      ts: number;
      kind: 'result';
      isError: boolean;
      durationMs: number | null;
      costUsd: number | null;
      /** Token usage as reported by the SDK — lets the UI show the math
       *  behind `costUsd` (cache reads are billed ~10% of normal input). */
      tokens?: {
        input: number;
        output: number;
        cacheRead: number;
        cacheCreate: number;
      };
      text: string;
    }
  | {
      seq: number;
      ts: number;
      kind: 'compaction';
      /** auto = SDK shrunk history to fit the context window; manual = user-triggered. */
      trigger: 'auto' | 'manual';
      preTokens: number;
    }
  | {
      seq: number;
      ts: number;
      kind: 'permission';
      requestId: string;
      toolName: string;
      input: unknown;
      /** Optional suggestions surfaced by the SDK (e.g. proposed input edits). */
      suggestions?: unknown;
      status: 'pending' | 'allowed' | 'denied';
      resolution: string | null;
    };

export interface PermissionRequest {
  requestId: string;
  sessionId: string;
  toolName: string;
  input: unknown;
  suggestions?: unknown;
}

export type PermissionDecision =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; message: string }
  // `answer` is used for elicitation tools (AskUserQuestion, ExitPlanMode):
  // the user provided a structured response. The server passes `data` back
  // to the SDK as the tool result so Claude can continue.
  | { behavior: 'answer'; data: string };

// ---- client -> server ------------------------------------------------------
export type ClientMessage =
  | { t: 'list' }
  | {
      t: 'create';
      cwd: string;
      title?: string;
      model?: string | null;
      permissionMode?: PermissionMode;
    }
  | { t: 'attach'; sessionId: string }
  | { t: 'detach'; sessionId: string }
  /** Ask the server for events older than `beforeSeq` — paginated history scroll. */
  | { t: 'loadEarlier'; sessionId: string; beforeSeq: number }
  | { t: 'input'; sessionId: string; text: string; images?: ChatImage[] }
  | { t: 'interrupt'; sessionId: string }
  | { t: 'delete'; sessionId: string }
  | { t: 'rename'; sessionId: string; title: string }
  | { t: 'archive'; sessionId: string; archived: boolean }
  | { t: 'permission'; sessionId: string; requestId: string; decision: PermissionDecision }
  | { t: 'setMode'; sessionId: string; permissionMode: PermissionMode }
  /** Switch the model — mid-session if a runner is live, else for next start. */
  | { t: 'setModel'; sessionId: string; model: string | null };

// ---- server -> client ------------------------------------------------------
export type ServerMessage =
  | { t: 'sessions'; sessions: SessionMeta[] }
  | { t: 'session'; session: SessionMeta }
  | {
      t: 'history';
      sessionId: string;
      meta: SessionMeta;
      /** Most recent slice of the session's events. */
      events: SessionEvent[];
      /** True if more events exist before the first event in this slice. */
      hasMore: boolean;
    }
  | {
      t: 'historyChunk';
      sessionId: string;
      events: SessionEvent[];
      hasMore: boolean;
    }
  | { t: 'event'; sessionId: string; event: SessionEvent }
  | { t: 'permission'; request: PermissionRequest }
  | { t: 'deleted'; sessionId: string }
  | { t: 'error'; message: string; sessionId?: string };
