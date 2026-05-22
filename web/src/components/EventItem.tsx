import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { SessionEvent } from '../protocol';
import { store } from '../store';
import { clockTime } from '../format';

type PermissionEvent = Extract<SessionEvent, { kind: 'permission' }>;

/** Renders one timeline event — the heart of the custom (non-terminal) UI. */
export function EventItem({ sessionId, event }: { sessionId: string; event: SessionEvent }) {
  switch (event.kind) {
    case 'user':
      return (
        <div className="ev ev-user">
          <div className="bubble">{event.text}</div>
        </div>
      );

    case 'assistant':
      return (
        <div className="ev ev-assistant">
          <div className="md">
            <Markdown remarkPlugins={[remarkGfm]}>{event.text}</Markdown>
          </div>
        </div>
      );

    case 'thinking':
      return (
        <Collapsible className="ev ev-thinking" summary="Thinking" body={event.text} collapsed />
      );

    case 'system':
      return (
        <div className="ev ev-system">
          <span>{event.text}</span>
        </div>
      );

    case 'result':
      return (
        <div className={`ev ev-result ${event.isError ? 'err' : ''}`}>
          <span>{event.text}</span>
          {event.durationMs != null && (
            <span className="chip">{(event.durationMs / 1000).toFixed(1)}s</span>
          )}
          {event.costUsd != null && <span className="chip">${event.costUsd.toFixed(4)}</span>}
        </div>
      );

    case 'tool_use':
      return (
        <Collapsible
          className="ev ev-tool"
          summary={`⚙  ${event.name}`}
          body={formatValue(event.input)}
        />
      );

    case 'tool_result':
      return (
        <Collapsible
          className={`ev ev-tool-result ${event.isError ? 'err' : ''}`}
          summary={event.isError ? '✕  Tool error' : '↳  Tool result'}
          body={event.content || '(empty)'}
          collapsed
        />
      );

    case 'permission':
      return <PermissionCard sessionId={sessionId} event={event} />;
  }

  return null;
}

function Collapsible(props: {
  className: string;
  summary: string;
  body: string;
  collapsed?: boolean;
}) {
  const [open, setOpen] = useState(!props.collapsed);
  return (
    <div className={props.className}>
      <button className="collapse-head" onClick={() => setOpen((v) => !v)}>
        <span className="caret">{open ? '▾' : '▸'}</span>
        <span className="collapse-summary">{props.summary}</span>
      </button>
      {open && <pre className="code">{props.body}</pre>}
    </div>
  );
}

function PermissionCard({
  sessionId,
  event,
}: {
  sessionId: string;
  event: PermissionEvent;
}) {
  const pending = event.status === 'pending';
  return (
    <div className={`ev ev-permission ${event.status}`}>
      <div className="perm-head">
        <span className="perm-badge">Permission</span>
        <span className="perm-tool">{event.toolName}</span>
        <span className="perm-time">{clockTime(event.ts)}</span>
      </div>
      <pre className="code">{formatValue(event.input)}</pre>
      {pending ? (
        <div className="perm-actions">
          <button
            className="btn btn-accent"
            onClick={() =>
              store.resolvePermission(sessionId, event.requestId, { behavior: 'allow' })
            }
          >
            Allow
          </button>
          <button
            className="btn btn-danger"
            onClick={() =>
              store.resolvePermission(sessionId, event.requestId, {
                behavior: 'deny',
                message: 'Denied from local-pilot.',
              })
            }
          >
            Deny
          </button>
        </div>
      ) : (
        <div className={`perm-resolved ${event.status}`}>{event.resolution}</div>
      )}
    </div>
  );
}

function formatValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
