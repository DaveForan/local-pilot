import { useSyncExternalStore } from 'react';
import type {
  ClientMessage,
  ServerMessage,
  SessionMeta,
  SessionEvent,
  PermissionDecision,
  PermissionMode,
} from './protocol';
import { api, type Snippet } from './api';

export interface PilotState {
  connected: boolean;
  sessions: SessionMeta[];
  /** Timeline events keyed by session id. */
  events: Record<string, SessionEvent[]>;
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
    sessions: [],
    events: {},
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
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.patch({ connected: true });
      // Re-attach to every session we were watching before the drop.
      for (const id of this.attached) this.raw({ t: 'attach', sessionId: id });
    };
    ws.onmessage = (ev) => {
      try {
        this.handle(JSON.parse(ev.data as string) as ServerMessage);
      } catch {
        /* ignore malformed frame */
      }
    };
    ws.onclose = () => {
      this.patch({ connected: false });
      this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer != null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 1500);
  }

  private raw(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
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
        this.attached.delete(msg.sessionId);
        this.patch({
          sessions: this.state.sessions.filter((s) => s.id !== msg.sessionId),
          events,
          activeId: this.state.activeId === msg.sessionId ? null : this.state.activeId,
        });
        break;
      }
      case 'history': {
        const rest = this.state.sessions.filter((s) => s.id !== msg.meta.id);
        this.attached.add(msg.sessionId);
        this.patch({
          sessions: sortSessions([...rest, msg.meta]),
          events: { ...this.state.events, [msg.sessionId]: msg.events },
          activeId: this.selectOnHistory ? msg.sessionId : this.state.activeId,
        });
        this.selectOnHistory = false;
        break;
      }
      case 'event':
        this.applyEvent(msg.sessionId, msg.event);
        break;
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
    this.patch({ events: { ...this.state.events, [sessionId]: next } });
  }

  // --- actions --------------------------------------------------------------

  select(id: string): void {
    if (!this.attached.has(id)) this.raw({ t: 'attach', sessionId: id });
    this.attached.add(id);
    this.patch({ activeId: id });
  }

  create(opts: {
    cwd: string;
    title?: string;
    model?: string | null;
    permissionMode?: PermissionMode;
  }): void {
    this.selectOnHistory = true;
    this.raw({ t: 'create', ...opts });
  }

  sendInput(sessionId: string, text: string): void {
    this.raw({ t: 'input', sessionId, text });
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

  resolvePermission(sessionId: string, requestId: string, decision: PermissionDecision): void {
    this.raw({ t: 'permission', sessionId, requestId, decision });
  }

  clearError(): void {
    this.patch({ error: null });
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
