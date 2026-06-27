import { useEffect, useState } from 'react';
import { api } from '../api';
import type { DirListing } from '../api';
import type { PermissionMode, ModelInfo } from '../protocol';
import { FALLBACK_MODELS, mergeModels } from '../models';
import { store } from '../store';
import { useEscapeClose } from '../useModal';

export function NewSessionDialog({ onClose }: { onClose: () => void }) {
  useEscapeClose(onClose);
  const [listing, setListing] = useState<DirListing | null>(null);
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<PermissionMode>('default');
  const [models, setModels] = useState<ModelInfo[]>(() => mergeModels([]));
  // Always an explicit, deliberate model — no "default" pass-through.
  const [model, setModel] = useState(FALLBACK_MODELS[0].value);
  const [err, setErr] = useState<string | null>(null);

  // Pull the SDK's account catalog and merge it with the explicit version pins
  // (so e.g. Opus 4.6 is selectable alongside the moving aliases). The server
  // probes the SDK at startup, so this is populated even before the first run.
  useEffect(() => {
    api
      .models()
      .then((list) => {
        const merged = mergeModels(list);
        setModels(merged);
        if (!merged.find((m) => m.value === model)) setModel(merged[0].value);
      })
      .catch(() => {
        /* keep fallback */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
            {models.map((m) => (
              <option key={m.value} value={m.value} title={m.description}>
                {m.displayName}
                {m.description ? ` — ${m.description}` : ''}
              </option>
            ))}
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
