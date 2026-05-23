import { useEffect, useRef, useState } from 'react';
import type { SessionEvent } from '../protocol';
import { store } from '../store';
import { clockTime, formatValue } from '../format';
import { AskUserQuestionCard } from './AskUserQuestionCard';
import { PlanApprovalCard } from './PlanApprovalCard';

type PermissionEvent = Extract<SessionEvent, { kind: 'permission' }>;

/** Routes each elicitation to a rich card; falls back to a generic
 *  allow/deny permission prompt for ordinary tool calls. */
export function PermissionCard({
  sessionId,
  event,
}: {
  sessionId: string;
  event: PermissionEvent;
}) {
  if (event.toolName === 'AskUserQuestion') {
    return <AskUserQuestionCard sessionId={sessionId} event={event} />;
  }
  if (event.toolName === 'ExitPlanMode') {
    return <PlanApprovalCard sessionId={sessionId} event={event} />;
  }
  return <GenericPermissionCard sessionId={sessionId} event={event} />;
}

/** The original allow / deny / allow-with-edits card for ordinary tool calls. */
function GenericPermissionCard({
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
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (pending) cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    <div
      ref={cardRef}
      className={`ev ev-permission ${event.status} ${pending ? 'pending-pulse' : ''}`}
    >
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
