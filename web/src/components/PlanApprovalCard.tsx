import { useEffect, useRef, useState } from 'react';
import type { SessionEvent } from '../protocol';
import { store } from '../store';
import { clockTime } from '../format';
import { Reply } from './Reply';

type PermissionEvent = Extract<SessionEvent, { kind: 'permission' }>;

/** Plan-approval UI for Claude's ExitPlanMode elicitation. Approving also
 *  switches the session out of plan mode so Claude can actually execute. */
export function PlanApprovalCard({
  sessionId,
  event,
}: {
  sessionId: string;
  event: PermissionEvent;
}) {
  const input = (event.input as { plan?: string } | null) ?? {};
  const plan = typeof input.plan === 'string' ? input.plan : '';
  const pending = event.status === 'pending';
  const [revising, setRevising] = useState(false);
  const [revisions, setRevisions] = useState('');
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (pending) cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const approve = (): void => {
    // Drop plan mode so Claude can act on what was approved.
    store.setMode(sessionId, 'default');
    store.resolvePermission(sessionId, event.requestId, {
      behavior: 'answer',
      data: 'Plan approved — proceed with the implementation.',
    });
  };

  const reject = (): void => {
    store.resolvePermission(sessionId, event.requestId, {
      behavior: 'answer',
      data: 'Plan rejected — please rethink the approach.',
    });
  };

  const sendRevisions = (): void => {
    const text = revisions.trim();
    if (!text) return;
    store.resolvePermission(sessionId, event.requestId, {
      behavior: 'answer',
      data: `Revise the plan: ${text}`,
    });
  };

  return (
    <div
      ref={cardRef}
      className={`ev ev-permission ev-plan ${event.status} ${pending ? 'pending-pulse' : ''}`}
    >
      <div className="perm-head">
        <span className="perm-badge perm-badge-plan">Plan</span>
        <span className="perm-tool">Claude proposes a plan</span>
        <span className="perm-time">{clockTime(event.ts)}</span>
      </div>

      <div className="plan-body md">
        <Reply>{plan || '_(empty plan)_'}</Reply>
      </div>

      {pending ? (
        revising ? (
          <>
            <textarea
              className="snippet-mgr-input"
              rows={3}
              value={revisions}
              onChange={(e) => setRevisions(e.target.value)}
              placeholder="What needs to change in the plan?"
            />
            <div className="perm-actions">
              <button
                className="btn btn-accent"
                disabled={revisions.trim() === ''}
                onClick={sendRevisions}
              >
                Send revisions
              </button>
              <button className="btn btn-ghost" onClick={() => setRevising(false)}>
                Back
              </button>
            </div>
          </>
        ) : (
          <div className="perm-actions">
            <button className="btn btn-accent" onClick={approve}>
              Approve plan
            </button>
            <button className="btn btn-ghost" onClick={() => setRevising(true)}>
              Revise
            </button>
            <button className="btn btn-danger" onClick={reject}>
              Reject
            </button>
          </div>
        )
      ) : (
        <div className={`perm-resolved ${event.status}`}>{event.resolution}</div>
      )}
    </div>
  );
}
