import { useEffect, useRef } from 'react';
import { usePilot } from '../store';

interface Props {
  /** Whether the composer currently holds text that could be saved. */
  hasDraft: boolean;
  onInsert: (body: string) => void;
  onSaveDraft: () => void;
  onManage: () => void;
  onClose: () => void;
}

/** Popover above the composer: tap a saved prompt to drop it into the input. */
export function SnippetMenu({ hasDraft, onInsert, onSaveDraft, onManage, onClose }: Props) {
  const { snippets } = usePilot();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    // Defer the outside-click listener so the click that opened the menu
    // does not immediately close it.
    const t = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    document.addEventListener('keydown', onEsc);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [onClose]);

  return (
    <div className="snippet-menu" ref={ref} role="menu">
      <div className="snippet-menu-head">Saved prompts</div>
      <div className="snippet-menu-list">
        {snippets.length === 0 && <div className="empty-hint">No saved prompts yet.</div>}
        {snippets.map((s) => (
          <button
            key={s.id}
            className="snippet-item"
            role="menuitem"
            onClick={() => {
              onInsert(s.body);
              onClose();
            }}
          >
            <span className="snippet-item-title">{s.title}</span>
            <span className="snippet-item-body">{s.body}</span>
          </button>
        ))}
      </div>
      <div className="snippet-menu-foot">
        <button
          className="btn btn-ghost btn-sm"
          disabled={!hasDraft}
          onClick={() => {
            onSaveDraft();
            onClose();
          }}
        >
          ＋ Save current message
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            onManage();
            onClose();
          }}
        >
          Manage…
        </button>
      </div>
    </div>
  );
}
