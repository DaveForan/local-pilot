import { useEffect, useState } from 'react';
import { api, type SkillInfo } from '../api';
import { McpEditor } from './McpEditor';
import { pushStatus, enablePush, disablePush, type PushStatus } from '../push';

type Tab = 'mcp' | 'skills' | 'push';

/** Settings modal — in-UI configuration of MCP servers and skills. */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('mcp');

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <h3>Settings</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close settings">
            ✕
          </button>
        </div>

        <div className="tabs">
          <button
            className={`tab ${tab === 'mcp' ? 'on' : ''}`}
            onClick={() => setTab('mcp')}
          >
            MCP servers
          </button>
          <button
            className={`tab ${tab === 'skills' ? 'on' : ''}`}
            onClick={() => setTab('skills')}
          >
            Skills
          </button>
          <button
            className={`tab ${tab === 'push' ? 'on' : ''}`}
            onClick={() => setTab('push')}
          >
            Notifications
          </button>
        </div>

        {tab === 'mcp' && <McpEditor />}
        {tab === 'skills' && <SkillsList />}
        {tab === 'push' && <NotificationsPanel />}
      </div>
    </div>
  );
}

/** Enable / disable web-push notifications for this device. */
function NotificationsPanel() {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    pushStatus().then(setStatus);
  }, []);

  const toggle = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      setStatus(status === 'on' ? await disablePush() : await enablePush());
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (status === null) return <div className="empty-hint">Loading…</div>;

  return (
    <div className="mcp-pane">
      <p className="settings-note">
        Get a notification when a session needs a permission decision or finishes a turn —
        even with local-pilot in the background.
      </p>

      {status === 'unsupported' && (
        <div className="form-err">This browser does not support push notifications.</div>
      )}
      {status === 'denied' && (
        <div className="form-err">
          Notifications are blocked. Re-enable them in your browser&rsquo;s site settings.
        </div>
      )}
      {(status === 'on' || status === 'off') && (
        <div className="push-toggle-row">
          <div className="push-toggle-text">
            <div className="push-state">
              {status === 'on' ? 'Enabled on this device' : 'Off on this device'}
            </div>
            <div className="push-hint">Requires the UI served over HTTPS or localhost.</div>
          </div>
          <button
            className={`btn ${status === 'on' ? 'btn-ghost' : 'btn-accent'}`}
            disabled={busy}
            onClick={() => void toggle()}
          >
            {busy ? '…' : status === 'on' ? 'Disable' : 'Enable'}
          </button>
        </div>
      )}
      {err && <div className="form-err">{err}</div>}
    </div>
  );
}

/** Read-only list of skills discovered in ~/.claude/skills. */
function SkillsList() {
  const [skills, setSkills] = useState<SkillInfo[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.skills().then(setSkills).catch((e) => setErr(String(e)));
  }, []);

  if (err) return <div className="form-err">{err}</div>;
  if (!skills) return <div className="empty-hint">Loading…</div>;

  return (
    <div className="mcp-pane">
      <p className="settings-note">
        Skills discovered in <code>~/.claude/skills</code>. Every session local-pilot starts can
        use them.
      </p>
      <div className="mcp-list">
        {skills.length === 0 && <div className="empty-hint">No skills found.</div>}
        {skills.map((s) => (
          <div key={s.name} className="mcp-row">
            <div className="mcp-row-text">
              <div className="mcp-row-name">{s.name}</div>
              <div className="mcp-row-sub">{s.description ?? s.path}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
