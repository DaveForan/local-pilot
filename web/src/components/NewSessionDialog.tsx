import { useEffect, useState } from 'react';
import { api } from '../api';
import type { DirListing } from '../api';
import type { PermissionMode } from '../protocol';
import { store } from '../store';
import { useEscapeClose } from '../useModal';

export function NewSessionDialog({ onClose }: { onClose: () => void }) {
  useEscapeClose(onClose);
  const [listing, setListing] = useState<DirListing | null>(null);
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<PermissionMode>('default');
  // Always an explicit, deliberate model — no "default" pass-through.
  const [model, setModel] = useState('claude-opus-4-7');
  const [err, setErr] = useState<string | null>(null);

  const browse = (path?: string): void => {
    setErr(null);
    api
      .fsList(path)
      .then(setListing)
      .catch((e) => setErr(String(e)));
  };

  useEffect(() => {
    browse();
  }, []);

  const create = (): void => {
    if (!listing) return;
    store.create({
      cwd: listing.path,
      title: title.trim() || undefined,
      permissionMode: mode,
      model,
    });
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="New session"
      >
        <h3>New session</h3>

        <label className="field">
          <span>Title (optional)</span>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. orbweaver bugfix"
          />
        </label>

        <label className="field">
          <span>Model</span>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="claude-opus-4-7">Claude Opus 4.7 — most capable</option>
            <option value="claude-sonnet-4-6">Claude Sonnet 4.6 — balanced</option>
            <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5 — fastest</option>
          </select>
        </label>

        <label className="field">
          <span>Permission mode</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as PermissionMode)}>
            <option value="default">Default — ask before each tool</option>
            <option value="acceptEdits">Auto-accept edits</option>
            <option value="plan">Plan mode</option>
            <option value="bypassPermissions">Bypass all permissions</option>
          </select>
        </label>

        <div className="field">
          <span>Working directory</span>
          <div className="browser">
            <div className="browser-path">{listing?.path ?? 'Loading…'}</div>
            <div className="browser-list">
              {listing && (
                <button className="browser-row up" onClick={() => browse(listing.parent)}>
                  ↑ ..
                </button>
              )}
              {listing?.dirs.map((d) => (
                <button key={d.path} className="browser-row" onClick={() => browse(d.path)}>
                  <span className="folder">📁</span> {d.name}
                </button>
              ))}
              {listing && listing.dirs.length === 0 && (
                <div className="empty-hint">No subdirectories here</div>
              )}
            </div>
          </div>
        </div>

        {err && <div className="form-err">{err}</div>}

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-accent" onClick={create} disabled={!listing}>
            Create here
          </button>
        </div>
      </div>
    </div>
  );
}
