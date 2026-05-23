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
  /** Slash commands the SDK exposes for this session (populated after init).
   *  Names come from the init message; description + argumentHint are
   *  enriched once the control-channel `supportedCommands()` RPC resolves. */
  slashCommands?: SlashCommand[];
}

/** Metadata for one slash command — matches the SDK's `SlashCommand` shape. */
export interface SlashCommand {
  name: string;
  description: string;
  argumentHint: string;
}

/** A base64-encoded image — attached by the user, or produced by a tool. */
export interface ChatImage {
  mediaType: string;
  /** base64 image bytes, with no data: URL prefix. */
  data: string;
}

/** A single entry in a session's rendered timeline. */
export type SessionEvent =
  | { seq: number; ts: number; kind: 'user'; text: string; images?: ChatImage[] }
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
  | { t: 'input'; sessionId: string; text: string; images?: ChatImage[] }
  | { t: 'interrupt'; sessionId: string }
  | { t: 'delete'; sessionId: string }
  | { t: 'rename'; sessionId: string; title: string }
  | { t: 'permission'; sessionId: string; requestId: string; decision: PermissionDecision }
  | { t: 'setMode'; sessionId: string; permissionMode: PermissionMode };

// ---- server -> client ------------------------------------------------------
export type ServerMessage =
  | { t: 'sessions'; sessions: SessionMeta[] }
  | { t: 'session'; session: SessionMeta }
  | { t: 'history'; sessionId: string; meta: SessionMeta; events: SessionEvent[] }
  | { t: 'event'; sessionId: string; event: SessionEvent }
  | { t: 'permission'; request: PermissionRequest }
  | { t: 'deleted'; sessionId: string }
  | { t: 'error'; message: string; sessionId?: string };
