import { useState } from 'react';
import type { SessionMeta } from '../protocol';
import { store } from '../store';

export function Composer({ session }: { session: SessionMeta }) {
  const [text, setText] = useState('');
  const busy = session.status === 'running' || session.status === 'awaiting_permission';
  const ended = session.status === 'ended';

  const submit = (): void => {
    const trimmed = text.trim();
    if (!trimmed || busy || ended) return;
    store.sendInput(session.id, trimmed);
    setText('');
  };

  return (
    <div className="composer">
      {busy && (
        <div className="composer-busy">
          <span className="spinner" />
          <span>
            {session.status === 'awaiting_permission'
              ? 'Waiting for your permission decision above'
              : 'Claude is working'}
          </span>
          <button
            className="btn btn-danger btn-sm"
            onClick={() => store.interrupt(session.id)}
          >
            Stop
          </button>
        </div>
      )}
      <div className="composer-row">
        <textarea
          className="composer-input"
          placeholder={ended ? 'Session ended' : 'Message Claude Code…  (Enter to send, Shift+Enter for newline)'}
          value={text}
          disabled={ended}
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button
          className="btn btn-accent send-btn"
          onClick={submit}
          disabled={!text.trim() || busy || ended}
        >
          Send
        </button>
      </div>
    </div>
  );
}
