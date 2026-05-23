import { useRef, useState } from 'react';
import { api } from '../api';

export function SecurityPanel() {
  const [rotating, setRotating] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const rotate = async (): Promise<void> => {
    const ok = window.confirm(
      'Rotate the access token? Every other device that has signed in will be ' +
        'signed out. Make sure you can copy the new token before closing this dialog.',
    );
    if (!ok) return;
    setRotating(true);
    setErr(null);
    setNewToken(null);
    setCopied(false);
    try {
      const res = await api.rotateToken();
      setNewToken(res.token);
    } catch (e) {
      setErr(String(e));
    } finally {
      setRotating(false);
    }
  };

  const onImportFile = async (file: File): Promise<void> => {
    if (
      !window.confirm(
        `Restore data from "${file.name}"? Existing sessions/snippets/configs ` +
          'with the same names will be overwritten. Active runners will be lost.',
      )
    ) {
      return;
    }
    setImporting(true);
    setImportMsg(null);
    setErr(null);
    try {
      await api.importData(file);
      await api.reloadData();
      setImportMsg('Imported and reloaded. Refresh the page to see restored sessions.');
    } catch (e) {
      setErr(String(e));
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const copyToken = async (): Promise<void> => {
    if (!newToken) return;
    try {
      await navigator.clipboard.writeText(newToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* user can still select + copy manually */
    }
  };

  return (
    <div className="mcp-pane">
      <h4 className="security-section-title">Access token</h4>
      <p className="settings-note">
        Rotating issues a new token, persists it to <code>~/.local-pilot/token</code>, and
        invalidates every other signed-in device. Your current session stays alive.
      </p>

      {newToken ? (
        <div className="security-new-token">
          <div className="security-token-label">New token (shown once)</div>
          <div className="security-token-value">{newToken}</div>
          <div className="settings-actions">
            <button className="btn btn-accent" onClick={copyToken}>
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button className="btn btn-ghost" onClick={() => setNewToken(null)}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <div className="settings-actions">
          <button className="btn btn-accent" onClick={rotate} disabled={rotating}>
            {rotating ? 'Rotating…' : 'Rotate token'}
          </button>
        </div>
      )}

      <h4 className="security-section-title security-section-title--spaced">
        Backup & restore
      </h4>
      <p className="settings-note">
        Export a tarball of your sessions, snippets, MCP servers, hooks and plugin paths.
        Local-only state (auth token, whisper/piper installs, push subscriptions) is excluded.
      </p>
      <div className="settings-actions">
        <a className="btn btn-accent" href={api.exportDataUrl()} download>
          Export data…
        </a>
        <button
          className="btn btn-ghost"
          onClick={() => fileRef.current?.click()}
          disabled={importing}
        >
          {importing ? 'Importing…' : 'Import data…'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".tar.gz,.tgz,application/gzip,application/x-gzip"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onImportFile(f);
          }}
        />
      </div>
      {importMsg && <div className="security-import-msg">{importMsg}</div>}

      {err && <div className="form-err">{err}</div>}
    </div>
  );
}
