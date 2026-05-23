import { useEffect, useState } from 'react';
import { api } from '../api';
import type { RewindResult } from '../protocol';
import { useEscapeClose } from '../useModal';

interface Props {
  sessionId: string;
  userUuid: string;
  userText: string;
  onClose: () => void;
}

/**
 * Two-phase rewind: open with a dry-run preview of what *would* change, then
 * the user confirms to apply for real. File checkpoints live in the running
 * SDK process, so this only works while the session has an active runner.
 */
export function RewindDialog({ sessionId, userUuid, userText, onClose }: Props) {
  useEscapeClose(onClose);
  const [preview, setPreview] = useState<RewindResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<RewindResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .rewindSession(sessionId, userUuid, true)
      .then((r) => {
        if (!cancelled) setPreview(r);
      })
      .catch((err) => {
        if (!cancelled) setPreviewError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, userUuid]);

  const apply = async (): Promise<void> => {
    setApplying(true);
    try {
      const r = await api.rewindSession(sessionId, userUuid, false);
      setApplied(r);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  };

  const snippet = userText.length > 80 ? userText.slice(0, 80) + '…' : userText;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Rewind files"
      >
        <div className="settings-head">
          <h3>Rewind files to this turn</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="settings-note">
          Restores tracked files to their state right before:
          <br />
          <em className="rewind-snippet">“{snippet}”</em>
        </p>

        {applied ? (
          <AppliedView result={applied} onClose={onClose} />
        ) : (
          <PreviewView
            preview={preview}
            previewError={previewError}
            applying={applying}
            onCancel={onClose}
            onApply={apply}
          />
        )}
      </div>
    </div>
  );
}

function PreviewView({
  preview,
  previewError,
  applying,
  onCancel,
  onApply,
}: {
  preview: RewindResult | null;
  previewError: string | null;
  applying: boolean;
  onCancel: () => void;
  onApply: () => void;
}) {
  if (previewError) {
    return (
      <>
        <div className="rewind-error">{previewError}</div>
        <div className="settings-actions">
          <button className="btn btn-ghost" onClick={onCancel}>
            Close
          </button>
        </div>
      </>
    );
  }
  if (!preview) {
    return <div className="rewind-loading">Checking what would change…</div>;
  }
  if (!preview.canRewind) {
    return (
      <>
        <div className="rewind-error">
          {preview.error ?? "Can't rewind to this point."}
        </div>
        <div className="settings-actions">
          <button className="btn btn-ghost" onClick={onCancel}>
            Close
          </button>
        </div>
      </>
    );
  }
  const files = preview.filesChanged ?? [];
  return (
    <>
      {files.length === 0 ? (
        <div className="rewind-summary">No files would change.</div>
      ) : (
        <>
          <div className="rewind-summary">
            <b>{files.length}</b> file{files.length === 1 ? '' : 's'} would change ·{' '}
            <span className="rewind-add">+{preview.insertions ?? 0}</span>{' '}
            <span className="rewind-del">−{preview.deletions ?? 0}</span>
          </div>
          <ul className="rewind-files">
            {files.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </>
      )}
      <div className="settings-actions">
        <button className="btn btn-ghost" onClick={onCancel} disabled={applying}>
          Cancel
        </button>
        <button className="btn btn-accent" onClick={onApply} disabled={applying}>
          {applying ? 'Rewinding…' : 'Rewind now'}
        </button>
      </div>
    </>
  );
}

function AppliedView({ result, onClose }: { result: RewindResult; onClose: () => void }) {
  const files = result.filesChanged ?? [];
  return (
    <>
      <div className="rewind-summary rewind-done">
        ✓ Rewound{' '}
        {files.length === 0
          ? '— no files changed'
          : `${files.length} file${files.length === 1 ? '' : 's'} (${result.insertions ?? 0}+/${result.deletions ?? 0}−)`}
      </div>
      {files.length > 0 && (
        <ul className="rewind-files">
          {files.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
      <div className="settings-actions">
        <button className="btn btn-accent" onClick={onClose}>
          Done
        </button>
      </div>
    </>
  );
}
