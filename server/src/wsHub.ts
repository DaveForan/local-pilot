import { WebSocketServer, WebSocket } from 'ws';
import type { Server, IncomingMessage } from 'node:http';
import type { SessionManager } from './sessionManager';
import type { ClientMessage, ServerMessage } from './protocol';
import { hasValidSession } from './auth';

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
        this.send(ws, {
          t: 'history',
          sessionId: session.meta.id,
          meta: session.meta,
          events: session.events,
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
        this.send(ws, {
          t: 'history',
          sessionId: session.meta.id,
          meta: session.meta,
          events: session.events,
        });
        break;
      }
      case 'detach':
        this.attachments.get(ws)?.delete(msg.sessionId);
        break;
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
