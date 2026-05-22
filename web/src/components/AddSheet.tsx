import { useEffect } from 'react';
import { usePilot } from '../store';

interface Props {
  hasDraft: boolean;
  onPickImage: () => void;
  onInsertSnippet: (body: string) => void;
  onSaveDraft: () => void;
  onManage: () => void;
  onClose: () => void;
}

/**
 * The "+" add-to-chat menu — a bottom sheet on phones, a centred modal on
 * wider screens. Stripped down: attach an image, or drop in a saved prompt.
 */
export function AddSheet({
  hasDraft,
  onPickImage,
  onInsertSnippet,
  onSaveDraft,
  onManage,
  onClose,
}: Props) {
  const { snippets } = usePilot();

  useEffect(() => {
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-head">Add to chat</div>

        <button
          className="sheet-item"
          onClick={() => {
            onClose();
            onPickImage();
          }}
        >
          <span className="sheet-icon">🖼</span>
          <span className="sheet-item-text">
            <span className="sheet-item-title">Photo or image</span>
            <span className="sheet-item-sub">Attach a picture for Claude to look at</span>
          </span>
        </button>

        <div className="sheet-section">Saved prompts</div>
        <div className="sheet-snippets">
          {snippets.length === 0 && <div className="empty-hint">No saved prompts yet.</div>}
          {snippets.map((s) => (
            <button
              key={s.id}
              className="sheet-snippet"
              onClick={() => {
                onInsertSnippet(s.body);
                onClose();
              }}
            >
              <span className="sheet-snippet-title">{s.title}</span>
              <span className="sheet-snippet-body">{s.body}</span>
            </button>
          ))}
        </div>

        <div className="sheet-foot">
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
    </div>
  );
}
