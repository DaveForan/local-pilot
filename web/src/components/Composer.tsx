import { useState } from 'react';
import type { SessionMeta } from '../protocol';
import { store } from '../store';
import { SnippetMenu } from './SnippetMenu';
import { SnippetManager } from './SnippetManager';

export function Composer({ session }: { session: SessionMeta }) {
  const [text, setText] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const busy = session.status === 'running' || session.status === 'awaiting_permission';
  const ended = session.status === 'ended';

  const submit = (): void => {
    const trimmed = text.trim();
    if (!trimmed || busy || ended) return;
    store.sendInput(session.id, trimmed);
    setText('');
  };

  /** Drop a saved prompt into the input, appending if there is already a draft. */
  const insertSnippet = (body: string): void => {
    setText((cur) => (cur.trim() ? `${cur.replace(/\s+$/, '')}\n${body}` : body));
  };

  /** Save whatever is currently typed as a new snippet. */
  const saveDraft = (): void => {
    const draft = text.trim();
    if (!draft) return;
    const title = window.prompt('Name this saved prompt:', draft.slice(0, 48));
    if (title && title.trim()) void store.createSnippet(title.trim(), draft);
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
          <button className="btn btn-danger btn-sm" onClick={() => store.interrupt(session.id)}>
            Stop
          </button>
        </div>
      )}

      <div className="composer-tools">
        <div className="snippet-anchor">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setMenuOpen((v) => !v)}
            disabled={ended}
          >
            🔖 Snippets
          </button>
          {menuOpen && (
            <SnippetMenu
              hasDraft={text.trim() !== ''}
              onInsert={insertSnippet}
              onSaveDraft={saveDraft}
              onManage={() => setManagerOpen(true)}
              onClose={() => setMenuOpen(false)}
            />
          )}
        </div>
      </div>

      <div className="composer-row">
        <textarea
          className="composer-input"
          placeholder={
            ended
              ? 'Session ended'
              : 'Message Claude Code…  (Enter to send, Shift+Enter for newline)'
          }
          value={text}
          disabled={ended}
          rows={2}
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

      {managerOpen && <SnippetManager onClose={() => setManagerOpen(false)} />}
    </div>
  );
}
