import { useEffect, useRef, useState } from 'react';
import type { SessionEvent } from '../protocol';
import { store } from '../store';
import { clockTime } from '../format';

type PermissionEvent = Extract<SessionEvent, { kind: 'permission' }>;

interface AskOption {
  label: string;
  description?: string;
  preview?: string;
}
interface AskQuestion {
  question: string;
  header?: string;
  options: AskOption[];
  multiSelect?: boolean;
}

const OTHER = '__other__';

/** Rich UI for Claude's AskUserQuestion elicitation tool — up to four
 *  multi-choice questions with optional previews and an "Other" escape hatch. */
export function AskUserQuestionCard({
  sessionId,
  event,
}: {
  sessionId: string;
  event: PermissionEvent;
}) {
  const input = (event.input as { questions?: AskQuestion[] } | null) ?? {};
  const questions = Array.isArray(input.questions) ? input.questions : [];
  const pending = event.status === 'pending';

  // picks[qi] = list of selected option labels (or OTHER) for that question.
  const [picks, setPicks] = useState<Record<number, string[]>>({});
  const [otherText, setOtherText] = useState<Record<number, string>>({});
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (pending) cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isPicked = (qi: number, label: string): boolean => (picks[qi] ?? []).includes(label);

  const togglePick = (qi: number, label: string, multi: boolean): void => {
    setPicks((cur) => {
      const sel = cur[qi] ?? [];
      const next = multi
        ? sel.includes(label)
          ? sel.filter((l) => l !== label)
          : [...sel, label]
        : [label];
      return { ...cur, [qi]: next };
    });
  };

  const answerFor = (qi: number, q: AskQuestion): string | string[] | null => {
    const labels = (picks[qi] ?? [])
      .map((l) => (l === OTHER ? (otherText[qi] ?? '').trim() : l))
      .filter((s) => s !== '');
    if (labels.length === 0) return null;
    return q.multiSelect ? labels : labels[0];
  };

  const allAnswered = questions.length > 0 && questions.every((q, i) => answerFor(i, q) !== null);

  const submit = (): void => {
    const answers: Record<string, string | string[]> = {};
    questions.forEach((q, i) => {
      const a = answerFor(i, q);
      if (a === null) return;
      // Two questions with identical wording would collide on this key and
      // one answer would silently overwrite the other.
      let key = q.question;
      if (key in answers) key = `${key} (${i + 1})`;
      answers[key] = a;
    });
    store.resolvePermission(sessionId, event.requestId, {
      behavior: 'answer',
      data: JSON.stringify({ answers }),
    });
  };

  const cancel = (): void => {
    store.resolvePermission(sessionId, event.requestId, {
      behavior: 'deny',
      message: 'User cancelled the question.',
    });
  };

  return (
    <div
      ref={cardRef}
      className={`ev ev-permission ev-ask ${event.status} ${pending ? 'pending-pulse' : ''}`}
    >
      <div className="perm-head">
        <span className="perm-badge perm-badge-ask">
          {questions.length > 1 ? 'Questions' : 'Question'}
        </span>
        <span className="perm-tool">Claude is asking</span>
        <span className="perm-time">{clockTime(event.ts)}</span>
      </div>

      {pending ? (
        <>
          {questions.map((q, qi) => (
            <div key={qi} className="ask-question">
              {q.header && <span className="ask-header">{q.header}</span>}
              <div className="ask-text">{q.question}</div>
              <div className="ask-options">
                {q.options.map((opt) => (
                  <button
                    key={opt.label}
                    type="button"
                    className={`ask-option ${isPicked(qi, opt.label) ? 'picked' : ''}`}
                    onClick={() => togglePick(qi, opt.label, q.multiSelect ?? false)}
                  >
                    <span className="ask-bullet">
                      {q.multiSelect
                        ? isPicked(qi, opt.label)
                          ? '☑'
                          : '☐'
                        : isPicked(qi, opt.label)
                          ? '●'
                          : '○'}
                    </span>
                    <span className="ask-option-text">
                      <span className="ask-option-label">{opt.label}</span>
                      {opt.description && (
                        <span className="ask-option-desc">{opt.description}</span>
                      )}
                    </span>
                  </button>
                ))}
                {/* Per the elicitation spec, an "Other" escape hatch is always offered. */}
                <button
                  type="button"
                  className={`ask-option ${isPicked(qi, OTHER) ? 'picked' : ''}`}
                  onClick={() => togglePick(qi, OTHER, q.multiSelect ?? false)}
                >
                  <span className="ask-bullet">
                    {q.multiSelect
                      ? isPicked(qi, OTHER)
                        ? '☑'
                        : '☐'
                      : isPicked(qi, OTHER)
                        ? '●'
                        : '○'}
                  </span>
                  <span className="ask-option-text">
                    <span className="ask-option-label">Other</span>
                  </span>
                </button>
                {isPicked(qi, OTHER) && (
                  <input
                    className="ask-other-input"
                    placeholder="Type your answer…"
                    value={otherText[qi] ?? ''}
                    onChange={(e) => setOtherText({ ...otherText, [qi]: e.target.value })}
                  />
                )}
              </div>
              {/* If a picked option has a preview, show it inline. */}
              {(picks[qi] ?? []).map((pickedLabel) => {
                const opt = q.options.find((o) => o.label === pickedLabel);
                return opt?.preview ? (
                  <pre key={pickedLabel} className="ask-preview">
                    {opt.preview}
                  </pre>
                ) : null;
              })}
            </div>
          ))}
          <div className="perm-actions">
            <button className="btn btn-accent" disabled={!allAnswered} onClick={submit}>
              Send {questions.length > 1 ? 'answers' : 'answer'}
            </button>
            <button className="btn btn-ghost" onClick={cancel}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <div className={`perm-resolved ${event.status}`}>{event.resolution}</div>
      )}
    </div>
  );
}
