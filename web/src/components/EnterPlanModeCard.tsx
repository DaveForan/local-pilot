import { useEffect, useRef } from 'react';
import type { SessionEvent } from '../protocol';
import { store } from '../store';
import { clockTime } from '../format';

type PermissionEvent = Extract<SessionEvent, { kind: 'permission' }>;

/** Friendlier render of Claude's `EnterPlanMode` request; approving also
 *  flips the session into plan mode so the drawer's mode reflects it. */
export function EnterPlanModeCard({
  sessionId,
  event,
}: {
  sessionId: string;
  event: PermissionEvent;
}) {
  const pending = event.status === 'pending';
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (pending) cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const approve = (): void => {
    store.resolvePermission(sessionId, event.requestId, { behavior: 'allow' });
    store.setMode(sessionId, 'plan');
  };
  const decline = (): void => {
    store.resolvePermission(sessionId, event.requestId, {
      behavior: 'deny',
      message: 'User declined entering plan mode.',
    });
  };

  return (
    <div
      ref={cardRef}
      className={`ev ev-permission ev-plan ${event.status} ${pending ? 'pending-pulse' : ''}`}
    >
      <div className="perm-head">
        <span className="perm-badge perm-badge-plan">Plan mode</span>
        <span className="perm-tool">Claude wants to switch to plan mode</span>
        <span className="perm-time">{clockTime(event.ts)}</span>
      </div>
      <div className="plan-intro">
        In plan mode Claude only researches and proposes a plan — it can't edit files
        or run mutating commands. You'll approve or revise the plan when it's ready.
      </div>
      {pending ? (
        <div className="perm-actions">
          <button className="btn btn-accent" onClick={approve}>
            Enter plan mode
          </button>
          <button className="btn btn-ghost" onClick={decline}>
            No, continue normally
          </button>
        </div>
      ) : (
        <div className={`perm-resolved ${event.status}`}>{event.resolution}</div>
      )}
    </div>
  );
}
