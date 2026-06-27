import { WebSocketServer, WebSocket } from 'ws';
import type { Server, IncomingMessage } from 'node:http';
import type { SessionManager } from './sessionManager';
import type { ClientMessage, ServerMessage } from './protocol';
import { hasValidSession } from './auth';

/** How many events to send per `history` / `historyChunk` page. ~200 events
 *  comfortably covers tens of turns and keeps the WS payload under ~1 MB
 *  even with long tool results, while still being one round trip. */
const HISTORY_PAGE_SIZE = 200;

/** What SessionManager needs to push messages out to browsers. */
export interface Broadcaster {
  toAll(msg: ServerMessage): void;
  toSession(sessionId: string, msg: ServerMessage): void;
}

/**
 * WebSocket layer. Each connection tracks which sessions it is attached to so
 * timeline events only fan out to interested clients; session-list changes go
 * to everyone.
 */
export class WsHub implements Broadcaster {
  private readonly wss: WebSocketServer;
  private readonly attachments = new Map<WebSocket, Set<string>>();

  constructor(
    server: Server,
    private readonly manager: SessionManager,
  ) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws, req) => this.onConnection(ws, req));
  }

  private onConnection(ws: WebSocket, req: IncomingMessage): void {
    // The session cookie rides along on the WebSocket handshake (same-origin),
    // so no secret ever appears in the URL.
    if (!hasValidSession(req.headers.cookie)) {
      ws.close(1008, 'unauthorized');
      return;
    }
    this.attachments.set(ws, new Set());
    this.send(ws, { t: 'sessions', sessions: this.manager.list() });
    ws.on('message', (raw) => this.onMessage(ws, raw.toString()));
    ws.on('close', () => this.attachments.delete(ws));
    ws.on('error', () => this.attachments.delete(ws));
  }

  private onMessage(ws: WebSocket, raw: string): void {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      this.send(ws, { t: 'error', message: 'Invalid JSON' });
      return;
    }
    try {
      this.route(ws, msg);
    } catch (err) {
      this.send(ws, {
        t: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private route(ws: WebSocket, msg: ClientMessage): void {
    switch (msg.t) {
      case 'list':
        this.send(ws, { t: 'sessions', sessions: this.manager.list() });
        break;
      case 'create': {
        const session = this.manager.create(msg);
        this.attachments.get(ws)?.add(session.meta.id);
        // Brand-new session: no events, no older history.
        this.send(ws, {
          t: 'history',
          sessionId: session.meta.id,
          meta: session.meta,
          events: session.events,
          hasMore: false,
        });
        break;
      }
      case 'attach': {
        const session = this.manager.get(msg.sessionId);
        if (!session) {
          this.send(ws, { t: 'error', message: 'Unknown session', sessionId: msg.sessionId });
          return;
        }
        this.attachments.get(ws)?.add(msg.sessionId);
        // Only send the most recent slice so initial load stays fast even
        // when the session has thousands of events. Client requests older
        // slices via `loadEarlier` when the user scrolls back.
        const all = session.events;
        const sliced = all.slice(-HISTORY_PAGE_SIZE);
        this.send(ws, {
          t: 'history',
          sessionId: session.meta.id,
          meta: session.meta,
          events: sliced,
          hasMore: sliced.length < all.length,
        });
        break;
      }
      case 'detach':
        this.attachments.get(ws)?.delete(msg.sessionId);
        break;
      case 'loadEarlier': {
        const session = this.manager.get(msg.sessionId);
        if (!session) return;
        const all = session.events;
        // Find index of first event with seq >= beforeSeq; we slice the
        // chunk immediately preceding it.
        let end = all.length;
        for (let i = 0; i < all.length; i++) {
          if (all[i].seq >= msg.beforeSeq) {
            end = i;
            break;
          }
        }
        const start = Math.max(0, end - HISTORY_PAGE_SIZE);
        this.send(ws, {
          t: 'historyChunk',
          sessionId: msg.sessionId,
          events: all.slice(start, end),
          hasMore: start > 0,
        });
        break;
      }
      case 'input':
        this.manager.input(msg.sessionId, msg.text, msg.images);
        break;
      case 'interrupt':
        this.manager.interrupt(msg.sessionId);
        break;
      case 'delete':
        void this.manager.delete(msg.sessionId);
        break;
      case 'permission':
        this.manager.resolvePermission(msg.sessionId, msg.requestId, msg.decision);
        break;
      case 'setMode':
        this.manager.setMode(msg.sessionId, msg.permissionMode);
        break;
      case 'setModel':
        this.manager.setModel(msg.sessionId, msg.model);
        break;
      case 'rename':
        this.manager.rename(msg.sessionId, msg.title);
        break;
      case 'archive':
        this.manager.setArchived(msg.sessionId, msg.archived);
        break;
    }
  }

  toAll(msg: ServerMessage): void {
    for (const ws of this.attachments.keys()) this.send(ws, msg);
  }

  toSession(sessionId: string, msg: ServerMessage): void {
    for (const [ws, attached] of this.attachments) {
      if (attached.has(sessionId)) this.send(ws, msg);
    }
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }
}
