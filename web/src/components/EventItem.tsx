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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => formatValue(event.input));
  const [jsonErr, setJsonErr] = useState<string | null>(null);

  const allow = (updatedInput?: Record<string, unknown>): void => {
    store.resolvePermission(sessionId, event.requestId, { behavior: 'allow', updatedInput });
  };

  const allowEdited = (): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft);
    } catch (e) {
      setJsonErr(`Invalid JSON — ${(e as Error).message}`);
      return;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setJsonErr('Tool input must be a JSON object.');
      return;
    }
    allow(parsed as Record<string, unknown>);
  };

  const deny = (): void => {
    store.resolvePermission(sessionId, event.requestId, {
      behavior: 'deny',
      message: 'Denied from local-pilot.',
    });
  };

  const suggestions = event.suggestions;
  const hasSuggestions =
    suggestions != null && (Array.isArray(suggestions) ? suggestions.length > 0 : true);

  return (
    <div className={`ev ev-permission ${event.status} ${pending ? 'pending-pulse' : ''}`}>
      <div className="perm-head">
        <span className="perm-badge">Permission</span>
        <span className="perm-tool">{event.toolName}</span>
        <span className="perm-time">{clockTime(event.ts)}</span>
      </div>

      {editing && pending ? (
        <>
          <textarea
            className="perm-edit"
            value={draft}
            spellCheck={false}
            rows={Math.min(16, draft.split('\n').length + 1)}
            onChange={(e) => {
              setDraft(e.target.value);
              setJsonErr(null);
            }}
          />
          {jsonErr && <div className="perm-json-err">{jsonErr}</div>}
        </>
      ) : (
        <pre className="code">{formatValue(event.input)}</pre>
      )}

      {hasSuggestions && (
        <div className="perm-suggest">
          <div className="perm-suggest-label">Claude suggested</div>
          <pre className="code">{formatValue(suggestions)}</pre>
        </div>
      )}

      {pending ? (
        <div className="perm-actions">
          {editing ? (
            <>
              <button className="btn btn-accent" onClick={allowEdited}>
                Allow with changes
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setEditing(false);
                  setDraft(formatValue(event.input));
                  setJsonErr(null);
                }}
              >
                Cancel edit
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-accent" onClick={() => allow()}>
                Allow
              </button>
              <button className="btn btn-ghost" onClick={() => setEditing(true)}>
                Edit input
              </button>
              <button className="btn btn-danger" onClick={deny}>
                Deny
              </button>
            </>
          )}
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
