import { useEffect, useState } from 'react';
import { api } from '../api';
import type { DirListing } from '../api';
import type { PermissionMode } from '../protocol';
import { store } from '../store';

export function NewSessionDialog({ onClose }: { onClose: () => void }) {
  const [listing, setListing] = useState<DirListing | null>(null);
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<PermissionMode>('default');
  const [model, setModel] = useState('default');
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
      // 'default' means: don't pin a model — use the Claude Code default.
      model: model === 'default' ? null : model,
    });
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>New session</h3>

        <label className="field">
          <span>Title (optional)</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. orbweaver bugfix"
          />
        </label>

        <label className="field">
          <span>Model</span>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="default">Default — your Claude Code setting</option>
            <option value="opus">Claude Opus — most capable</option>
            <option value="sonnet">Claude Sonnet — balanced</option>
            <option value="haiku">Claude Haiku — fastest</option>
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
