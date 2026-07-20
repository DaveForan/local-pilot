import { useMemo } from 'react';
import type { SessionEvent } from '../protocol';
import { PermissionCard } from './PermissionCard';
import { useEscapeClose } from '../useModal';
import { store } from '../store';

type PermissionEvent = Extract<SessionEvent, { kind: 'permission' }>;

/**
 * Forces every pending permission request to a modal overlay so it can't be
 * missed or buried mid-scroll. Covers both elicitations (AskUserQuestion,
 * ExitPlanMode, EnterPlanMode — rendered via their rich cards) and ordinary
 * tool approvals (Bash, Write, etc. — rendered via the generic allow/deny
 * card). Routing is whatever PermissionCard already does, so the modal
 * always matches what the inline card would have shown.
 *
 * The inline card in the timeline still renders, so the resolution appears
 * in the conversation history once you answer. Modal closes automatically
 * when the event status flips off "pending".
 */
export function ElicitationModal({
  sessionId,
  events,
}: {
  sessionId: string | null;
  events: SessionEvent[];
}) {
  // Find the most recent *pending* permission in this session — any tool,
  // not just elicitations, so Bash/Write/etc. approvals also pop.
  const pending = useMemo<PermissionEvent | null>(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.kind === 'permission' && e.status === 'pending') return e;
    }
    return null;
  }, [events]);

  // Esc to dismiss = deny with "user cancelled" — leaves the workflow in a
  // clean state instead of a half-pending tool call (which was tripping the
  // dup-tool-use 400s before we fixed orphan resolution).
  const cancel = (): void => {
    if (!sessionId || !pending) return;
    store.resolvePermission(sessionId, pending.requestId, {
      behavior: 'deny',
      message: 'User dismissed the request.',
    });
  };
  useEscapeClose(cancel);

  if (!sessionId || !pending) return null;

  return (
    // Deliberately no onClick on the backdrop: a stray tap outside the modal
    // (easy on mobile) must not silently deny a pending approval. Dismissal
    // is Esc or an explicit button on the card.
    <div className="modal-backdrop elicitation-backdrop">
      <div
        className="modal modal-wide elicitation-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Claude is asking"
      >
        <PermissionCard sessionId={sessionId} event={pending} />
        <div className="elicitation-hint">Press Esc to dismiss</div>
      </div>
    </div>
  );
}
