import type { SessionMeta } from '../protocol';
import { relativeTime, shortPath } from '../format';
import { STATUS } from './status';

interface Props {
  sessions: SessionMeta[];
  activeId: string | null;
  open: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
}

export function Sidebar({ sessions, activeId, open, onSelect, onNew, onClose }: Props) {
  return (
    <>
      {open && <div className="drawer-backdrop" onClick={onClose} />}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-head">
          <span>Sessions</span>
          <button className="btn btn-accent btn-sm" onClick={onNew}>
            + New
          </button>
        </div>

        <div className="session-list">
          {sessions.length === 0 && (
            <div className="empty-hint">
              No sessions yet.
              <br />
              Create one to start.
            </div>
          )}
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
                  <span className="session-title">{s.title}</span>
                  <span className="session-sub">{shortPath(s.cwd)}</span>
                </span>
                <span className="session-time">{relativeTime(s.lastActivity)}</span>
              </button>
            );
          })}
        </div>
      </aside>
    </>
  );
}
