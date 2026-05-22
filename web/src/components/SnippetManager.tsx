import { useState } from 'react';
import { usePilot, store } from '../store';

/** Modal for adding and removing saved prompts. */
export function SnippetManager({ onClose }: { onClose: () => void }) {
  const { snippets } = usePilot();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  const canAdd = title.trim() !== '' && body.trim() !== '' && !saving;

  const add = async (): Promise<void> => {
    if (!canAdd) return;
    setSaving(true);
    await store.createSnippet(title.trim(), body.trim());
    setSaving(false);
    setTitle('');
    setBody('');
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Saved prompts</h3>

        <div className="snippet-mgr-list">
          {snippets.length === 0 && <div className="empty-hint">Nothing saved yet.</div>}
          {snippets.map((s) => (
            <div key={s.id} className="snippet-mgr-row">
              <div className="snippet-mgr-text">
                <div className="snippet-mgr-title">{s.title}</div>
                <div className="snippet-mgr-body">{s.body}</div>
              </div>
              <button
                className="icon-btn"
                aria-label={`Delete ${s.title}`}
                onClick={() => void store.deleteSnippet(s.id)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <label className="field">
          <span>New prompt — title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Run the test suite"
          />
        </label>
        <label className="field">
          <span>New prompt — body</span>
          <textarea
            className="snippet-mgr-input"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder="The message text to insert into the composer…"
          />
        </label>

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
          <button className="btn btn-accent" disabled={!canAdd} onClick={() => void add()}>
            {saving ? 'Adding…' : 'Add prompt'}
          </button>
        </div>
      </div>
    </div>
  );
}
