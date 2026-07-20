import { useSyncExternalStore } from 'react';
import type {
  ClientMessage,
  ServerMessage,
  SessionMeta,
  SessionEvent,
  PermissionDecision,
  PermissionMode,
  EffortLevel,
  ChatImage,
} from './protocol';
import { api, type Snippet } from './api';

export type ConnectionState =
  | 'connecting' // first attempt, no result yet
  | 'open' // WS is up
  | 'retrying' // dropped, scheduled to retry
  | 'auth_expired' // server rejected the handshake — cookie is invalid
  | 'unreachable'; // multiple back-to-back failures — server seems down

export interface PilotState {
  connected: boolean;
  /** Fine-grained connection state — connected is true iff this is 'open'. */
  conn: ConnectionState;
  /** Consecutive failed attempts since the last successful open. */
  retryCount: number;
  sessions: SessionMeta[];
  /** Timeline events keyed by session id. */
  events: Record<string, SessionEvent[]>;
  /** Per-session flag: true when older events than the loaded slice exist. */
  hasMore: Record<string, boolean>;
  /** Per-session flag: a `loadEarlier` request is in flight. */
  loadingEarlier: Record<string, boolean>;
  /** Accumulated streaming text of the in-flight reply, keyed by session id.
   *  Cleared when the complete assistant event (or the turn result) lands. */
  partial: Record<string, string>;
  activeId: string | null;
  error: string | null;
  /** Saved prompts, loaded once over REST (not the WebSocket). */
  snippets: Snippet[];
}

/**
 * Single source of truth for the UI: holds the WebSocket connection and the
 * derived state, exposed to React through `useSyncExternalStore`.
 */
class PilotStore {
  private state: PilotState = {
    connected: false,
    conn: 'connecting',
    retryCount: 0,
    sessions: [],
    events: {},
    hasMore: {},
    loadingEarlier: {},
    partial: {},
    activeId: null,
    error: null,
    snippets: [],
  };

  private readonly listeners = new Set<() => void>();
  private readonly attached = new Set<string>();
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private selectOnHistory = false;
  private snippetsLoaded = false;

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    this.ensureConnected();
    this.ensureSnippetsLoaded();
    return () => this.listeners.delete(cb);
  };

  getSnapshot = (): PilotState => this.state;

  private patch(next: Partial<PilotState>): void {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }

  // --- connection -----------------------------------------------------------

  private ensureConnected(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.connect();
  }

  private connect(): void {
    // The reconnect timer and ensureConnected can race — if a live (or
    // in-flight) socket already exists, opening a second one would orphan it
    // and let its eventual close corrupt the connection state.
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    if (this.reconnectTimer != null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    // The session cookie authenticates the handshake automatically.
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    if (this.state.conn !== 'open') this.patch({ conn: 'connecting' });
    ws.onopen = () => {
      if (this.ws !== ws) {
        ws.close();
        return;
      }
      this.patch({ connected: true, conn: 'open', retryCount: 0 });
      // Re-attach to every session we were watching before the drop.
      for (const id of this.attached) this.raw({ t: 'attach', sessionId: id });
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return; // stale socket — ignore
      try {
        this.handle(JSON.parse(ev.data as string) as ServerMessage);
      } catch {
        /* ignore malformed frame */
      }
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return; // a newer socket owns the state now
      // 4401 (or any 4xxx) is what we'd use server-side if the cookie was
      // bad; treat it as auth expired so the UI can force a re-login.
      // Otherwise classify by retry count so the user can tell "drop in
      // progress" from "server probably down".
      let nextConn: ConnectionState;
      const nextRetry = this.state.retryCount + 1;
      if (ev.code === 4401 || ev.code === 1008) {
        nextConn = 'auth_expired';
      } else if (nextRetry >= 4) {
        nextConn = 'unreachable';
      } else {
        nextConn = 'retrying';
      }
      this.patch({ connected: false, conn: nextConn, retryCount: nextRetry });
      if (nextConn !== 'auth_expired') this.scheduleReconnect(nextRetry);
    };
    ws.onerror = () => ws.close();
  }

  /** Exponential backoff capped at 30s. Resets to 0 on successful open. */
  private scheduleReconnect(retryCount: number): void {
    if (this.reconnectTimer != null) return;
    const delay = Math.min(30_000, 1500 * Math.pow(1.7, Math.min(8, retryCount - 1)));
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /** Send if the socket is open; returns false (instead of silently dropping
   *  the message) when it isn't, so callers can keep the user's input. */
  private raw(msg: ClientMessage): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  // --- inbound --------------------------------------------------------------

  private handle(msg: ServerMessage): void {
    switch (msg.t) {
      case 'sessions':
        this.patch({ sessions: sortSessions(msg.sessions) });
        break;
      case 'session': {
        const rest = this.state.sessions.filter((s) => s.id !== msg.session.id);
        this.patch({ sessions: sortSessions([...rest, msg.session]) });
        break;
      }
      case 'deleted': {
        const events = { ...this.state.events };
        delete events[msg.sessionId];
        const partial = { ...this.state.partial };
        delete partial[msg.sessionId];
        this.attached.delete(msg.sessionId);
        this.patch({
          partial,
          sessions: this.state.sessions.filter((s) => s.id !== msg.sessionId),
          events,
          activeId: this.state.activeId === msg.sessionId ? null : this.state.activeId,
        });
        break;
      }
      case 'history': {
        const rest = this.state.sessions.filter((s) => s.id !== msg.meta.id);
        this.attached.add(msg.sessionId);
        // A re-attach (reconnect, tab refocus) sends only the newest slice.
        // Keep any older pages the user already loaded via "Load earlier"
        // instead of collapsing the timeline underneath them.
        const existing = this.state.events[msg.sessionId] ?? [];
        let events = msg.events;
        let hasMore = msg.hasMore;
        if (existing.length > 0 && msg.events.length > 0) {
          const incomingOldest = msg.events[0].seq;
          const seen = new Set(msg.events.map((e) => e.seq));
          const olderPages = existing.filter((e) => e.seq < incomingOldest && !seen.has(e.seq));
          if (olderPages.length > 0) {
            events = [...olderPages, ...msg.events];
            // Our oldest event is older than the slice's — whether even older
            // ones exist is what we knew before, not what this slice says.
            hasMore = this.state.hasMore[msg.sessionId] ?? msg.hasMore;
          }
        }
        this.patch({
          sessions: sortSessions([...rest, msg.meta]),
          events: { ...this.state.events, [msg.sessionId]: events },
          hasMore: { ...this.state.hasMore, [msg.sessionId]: hasMore },
          loadingEarlier: { ...this.state.loadingEarlier, [msg.sessionId]: false },
          // A fresh history pull invalidates any half-streamed preview.
          partial: { ...this.state.partial, [msg.sessionId]: '' },
          activeId: this.selectOnHistory ? msg.sessionId : this.state.activeId,
        });
        this.selectOnHistory = false;
        break;
      }
      case 'historyChunk': {
        // Prepend the older slice; Timeline preserves scroll-position so the
        // viewport stays anchored on whatever the user was looking at.
        const existing = this.state.events[msg.sessionId] ?? [];
        const seen = new Set(existing.map((e) => e.seq));
        const fresh = msg.events.filter((e) => !seen.has(e.seq));
        this.patch({
          events: {
            ...this.state.events,
            [msg.sessionId]: [...fresh, ...existing].sort((a, b) => a.seq - b.seq),
          },
          hasMore: { ...this.state.hasMore, [msg.sessionId]: msg.hasMore },
          loadingEarlier: { ...this.state.loadingEarlier, [msg.sessionId]: false },
        });
        break;
      }
      case 'event':
        this.applyEvent(msg.sessionId, msg.event);
        break;
      case 'partial': {
        const cur = this.state.partial[msg.sessionId] ?? '';
        this.patch({ partial: { ...this.state.partial, [msg.sessionId]: cur + msg.text } });
        break;
      }
      case 'permission':
        // The inline `permission` timeline event already drives the UI;
        // this message is reserved for future push notifications.
        break;
      case 'error':
        this.patch({ error: msg.message });
        break;
    }
  }

  /** Insert or replace an event, keyed by its monotonic `seq`. */
  private applyEvent(sessionId: string, event: SessionEvent): void {
    const list = this.state.events[sessionId] ?? [];
    const exists = list.some((e) => e.seq === event.seq);
    const next = exists
      ? list.map((e) => (e.seq === event.seq ? event : e))
      : [...list, event].sort((a, b) => a.seq - b.seq);
    // The complete assistant text (or the turn's result) supersedes the
    // streamed preview — clear it in the same patch so there's no flicker
    // frame where both render.
    const clearPartial =
      (event.kind === 'assistant' || event.kind === 'result') &&
      (this.state.partial[sessionId] ?? '') !== '';
    this.patch({
      events: { ...this.state.events, [sessionId]: next },
      ...(clearPartial ? { partial: { ...this.state.partial, [sessionId]: '' } } : {}),
    });
  }

  // --- actions --------------------------------------------------------------

  select(id: string): void {
    if (!this.attached.has(id)) this.raw({ t: 'attach', sessionId: id });
    this.attached.add(id);
    this.patch({ activeId: id });
  }

  /** Force a fresh history pull for the active session. Used when the tab
   *  becomes visible again — the WS may be open but the server already lost
   *  track of us on a TCP timeout, leaving the event log stale (in particular,
   *  pending elicitations that arrived while we were away). */
  refreshActive(): void {
    const id = this.state.activeId;
    if (!id) return;
    this.raw({ t: 'attach', sessionId: id });
  }

  /** Request the page of events immediately older than the oldest one we have. */
  loadEarlier(sessionId: string): void {
    if (this.state.loadingEarlier[sessionId]) return;
    if (this.state.hasMore[sessionId] === false) return;
    const list = this.state.events[sessionId] ?? [];
    if (list.length === 0) return;
    const beforeSeq = list[0].seq;
    this.patch({
      loadingEarlier: { ...this.state.loadingEarlier, [sessionId]: true },
    });
    this.raw({ t: 'loadEarlier', sessionId, beforeSeq });
  }

  create(opts: {
    cwd: string;
    title?: string;
    model?: string | null;
    effort?: EffortLevel | null;
    permissionMode?: PermissionMode;
  }): void {
    this.selectOnHistory = true;
    this.raw({ t: 'create', ...opts });
  }

  /** Returns false when the message could not be sent (socket not open). */
  sendInput(sessionId: string, text: string, images?: ChatImage[]): boolean {
    return this.raw({ t: 'input', sessionId, text, images });
  }

  interrupt(sessionId: string): void {
    this.raw({ t: 'interrupt', sessionId });
  }

  remove(sessionId: string): void {
    this.raw({ t: 'delete', sessionId });
  }

  setMode(sessionId: string, permissionMode: PermissionMode): void {
    this.raw({ t: 'setMode', sessionId, permissionMode });
  }

  setModel(sessionId: string, model: string | null): void {
    this.raw({ t: 'setModel', sessionId, model });
  }

  setEffort(sessionId: string, effort: EffortLevel | null): void {
    this.raw({ t: 'setEffort', sessionId, effort });
  }

  rename(sessionId: string, title: string): void {
    this.raw({ t: 'rename', sessionId, title });
  }

  setArchived(sessionId: string, archived: boolean): void {
    this.raw({ t: 'archive', sessionId, archived });
  }

  resolvePermission(sessionId: string, requestId: string, decision: PermissionDecision): void {
    this.raw({ t: 'permission', sessionId, requestId, decision });
  }

  clearError(): void {
    this.patch({ error: null });
  }

  /** Surface a client-side problem in the same banner server errors use. */
  reportError(message: string): void {
    this.patch({ error: message });
  }

  // --- snippets (saved prompts, REST-backed) --------------------------------

  private ensureSnippetsLoaded(): void {
    if (this.snippetsLoaded) return;
    this.snippetsLoaded = true;
    void this.reloadSnippets();
  }

  async reloadSnippets(): Promise<void> {
    try {
      this.patch({ snippets: await api.snippets() });
    } catch {
      this.snippetsLoaded = false; // allow a later retry
    }
  }

  async createSnippet(title: string, body: string): Promise<void> {
    try {
      const snippet = await api.addSnippet(title, body);
      this.patch({ snippets: [...this.state.snippets, snippet] });
    } catch (err) {
      this.patch({ error: `Could not save snippet: ${errText(err)}` });
    }
  }

  async deleteSnippet(id: string): Promise<void> {
    try {
      await api.deleteSnippet(id);
      this.patch({ snippets: this.state.snippets.filter((s) => s.id !== id) });
    } catch (err) {
      this.patch({ error: `Could not delete snippet: ${errText(err)}` });
    }
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sortSessions(list: SessionMeta[]): SessionMeta[] {
  return [...list].sort((a, b) => b.lastActivity - a.lastActivity);
}

export const store = new PilotStore();

export function usePilot(): PilotState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
