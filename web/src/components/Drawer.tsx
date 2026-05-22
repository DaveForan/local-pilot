import type { SessionMeta, PermissionMode } from '../protocol';
import { store } from '../store';
import { relativeTime, shortPath } from '../format';
import { STATUS } from './status';
import type { Theme } from '../theme';

const MODE_LABEL: Record<PermissionMode, string> = {
  default: 'Default · ask each tool',
  acceptEdits: 'Auto-accept edits',
  plan: 'Plan mode',
  bypassPermissions: 'Bypass permissions',
};

interface Props {
  open: boolean;
  sessions: SessionMeta[];
  activeId: string | null;
  active: SessionMeta | null;
  /** Resolved model for the active session (may be recovered from history). */
  activeModel: string | null;
  connected: boolean;
  theme: Theme;
  onSelect: (id: string) => void;
  onNew: () => void;
  onOpenSettings: () => void;
  onToggleTheme: () => void;
  onClose: () => void;
}

/**
 * The single navigation surface — slides in from the hamburger. Holds the
 * session list, the current session's details + controls, and app nav, so
 * the chat view itself stays free of session chrome.
 */
export function Drawer({
  open,
  sessions,
  activeId,
  active,
  activeModel,
  connected,
  theme,
  onSelect,
  onNew,
  onOpenSettings,
  onToggleTheme,
  onClose,
}: Props) {
  return (
    <>
      {open && <div className="drawer-backdrop" onClick={onClose} />}
      <aside className={`drawer ${open ? 'open' : ''}`} aria-hidden={!open}>
        <div className="drawer-head">
          <span className="wordmark">
            <span className="dot-logo" />
            local<b>pilot</b>
          </span>
          <button className="icon-btn" onClick={onClose} aria-label="Close menu">
            ✕
          </button>
        </div>

        <div className="drawer-scroll">
          <button className="btn btn-accent drawer-new" onClick={onNew}>
            ＋ New session
          </button>

          <div className="drawer-section-label">Sessions</div>
          <div className="session-list">
            {sessions.length === 0 && <div className="empty-hint">No sessions yet.</div>}
            {sessions.map((s) => {
              const st = STATUS[s.status];
              return (
                <button
                  key={s.id}
                  className={`session-card ${s.id === activeId ? 'active' : ''} ${
                    s.status === 'awaiting_permission' ? 'attention' : ''
                  }`}
                  onClick={() => onSelect(s.id)}
                >
                  <span
                    className={`status-dot ${s.status === 'running' ? 'pulse' : ''}`}
                    style={{ background: st.color }}
                    title={st.label}
                  />
                  <span className="session-meta">
                    <span className="session-title">
                      <span className="session-title-text">{s.title}</span>
                      {s.status === 'awaiting_permission' && (
                        <span className="needs-you-pill">Needs you</span>
                      )}
                    </span>
                    <span className="session-sub">{shortPath(s.cwd)}</span>
                  </span>
                  <span className="session-time">{relativeTime(s.lastActivity)}</span>
                </button>
              );
            })}
          </div>

          {active && (
            <div className="current-session">
              <div className="drawer-section-label">Current session</div>
              <div className="cs-title">{active.title}</div>
              <div className="cs-row">
                <span>Status</span>
                <span>{STATUS[active.status].label}</span>
              </div>
              <div className="cs-row">
                <span>Folder</span>
                <span className="cs-mono" title={active.cwd}>
                  {shortPath(active.cwd, 28)}
                </span>
              </div>
              <div className="cs-row">
                <span>Model</span>
                <span className="cs-mono">{activeModel ?? 'not yet started'}</span>
              </div>
              <label className="cs-field">
                <span>Permission mode</span>
                <select
                  value={active.permissionMode}
                  onChange={(e) => store.setMode(active.id, e.target.value as PermissionMode)}
                >
                  {(Object.keys(MODE_LABEL) as PermissionMode[]).map((m) => (
                    <option key={m} value={m}>
                      {MODE_LABEL[m]}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="btn btn-ghost drawer-danger"
                onClick={() => {
                  if (window.confirm(`Delete session “${active.title}”?`)) {
                    store.remove(active.id);
                  }
                }}
              >
                Delete session
              </button>
            </div>
          )}
        </div>

        <div className="drawer-foot">
          <button className="drawer-nav-item" onClick={onOpenSettings}>
            <span className="drawer-nav-icon">⚙</span> Settings
          </button>
          <button className="drawer-nav-item" onClick={onToggleTheme}>
            <span className="drawer-nav-icon">{theme === 'dark' ? '☀' : '☾'}</span>
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          <div className={`conn ${connected ? 'on' : 'off'}`}>
            <span className="conn-dot" />
            {connected ? 'Connected' : 'Reconnecting…'}
          </div>
        </div>
      </aside>
    </>
  );
}
