import { useMemo } from 'react';
import type { SessionEvent } from '../protocol';
import { AskUserQuestionCard } from './AskUserQuestionCard';
import { PlanApprovalCard } from './PlanApprovalCard';
import { EnterPlanModeCard } from './EnterPlanModeCard';
import { useEscapeClose } from '../useModal';
import { store } from '../store';

type PermissionEvent = Extract<SessionEvent, { kind: 'permission' }>;

const ELICITATION_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode', 'EnterPlanMode']);

/**
 * Forces every pending elicitation to a modal overlay so it can't be missed
 * or buried mid-scroll. The inline card in the timeline still renders (and
 * shows the resolution after answering), but while it's pending the modal
 * is what the user actually interacts with. Resolving the permission inside
 * the modal closes it automatically, since the event status flips off
 * "pending".
 */
export function ElicitationModal({
  sessionId,
  events,
}: {
  sessionId: string | null;
  events: SessionEvent[];
}) {
  // Find the most recent *pending* elicitation in this session.
  const pending = useMemo<PermissionEvent | null>(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (
        e.kind === 'permission' &&
        e.status === 'pending' &&
        ELICITATION_TOOLS.has(e.toolName)
      ) {
        return e;
      }
    }
    return null;
  }, [events]);

  // Esc to dismiss = deny with "user cancelled" — leave the workflow in a
  // clean state instead of a half-pending tool call (which is what was
  // tripping the dup-tool-use 400s).
  const cancel = (): void => {
    if (!sessionId || !pending) return;
    store.resolvePermission(sessionId, pending.requestId, {
      behavior: 'deny',
      message: 'User dismissed the question.',
    });
  };
  useEscapeClose(cancel);

  if (!sessionId || !pending) return null;

  return (
    <div className="modal-backdrop elicitation-backdrop" onClick={cancel}>
      <div
        className="modal modal-wide elicitation-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Claude is asking"
      >
        {pending.toolName === 'AskUserQuestion' && (
          <AskUserQuestionCard sessionId={sessionId} event={pending} />
        )}
        {pending.toolName === 'ExitPlanMode' && (
          <PlanApprovalCard sessionId={sessionId} event={pending} />
        )}
        {pending.toolName === 'EnterPlanMode' && (
          <EnterPlanModeCard sessionId={sessionId} event={pending} />
        )}
        <div className="elicitation-hint">Press Esc to dismiss</div>
      </div>
    </div>
  );
}
