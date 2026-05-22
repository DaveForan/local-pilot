import type { SessionMeta, PermissionMode } from '../protocol';
import { usePilot, store } from '../store';
import { Timeline } from './Timeline';
import { Composer } from './Composer';
import { STATUS } from './status';
import { shortPath } from '../format';

const MODE_LABEL: Record<PermissionMode, string> = {
  default: 'Default · ask each tool',
  acceptEdits: 'Auto-accept edits',
  plan: 'Plan mode',
  bypassPermissions: 'Bypass permissions',
};

export function ChatPane({ session }: { session: SessionMeta | null }) {
  const { events } = usePilot();

  if (!session) {
    return (
      <div className="pane-empty">
        <div className="pane-empty-inner">
          <span className="dot-logo big" />
          <h2>No session selected</h2>
          <p>Pick a session from the list, or create a new one to start driving Claude Code.</p>
        </div>
      </div>
    );
  }

  const st = STATUS[session.status];
  const list = events[session.id] ?? [];

  return (
    <div className="chat">
      <div className="chat-head">
        <div className="chat-head-main">
          <span
            className={`status-dot ${session.status === 'running' ? 'pulse' : ''}`}
            style={{ background: st.color }}
          />
          <div className="chat-head-text">
            <div className="chat-title">{session.title}</div>
            <div className="chat-sub">
              {st.label}
              {session.model ? ` · ${session.model}` : ''} · {shortPath(session.cwd, 52)}
            </div>
          </div>
        </div>
        <div className="chat-head-actions">
          <select
            className="mode-select"
            value={session.permissionMode}
            onChange={(e) => store.setMode(session.id, e.target.value as PermissionMode)}
          >
            {(Object.keys(MODE_LABEL) as PermissionMode[]).map((m) => (
              <option key={m} value={m}>
                {MODE_LABEL[m]}
              </option>
            ))}
          </select>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              if (confirm(`Delete session "${session.title}"?`)) store.remove(session.id);
            }}
          >
            Delete
          </button>
        </div>
      </div>

      <Timeline sessionId={session.id} events={list} status={session.status} />
      <Composer session={session} />
    </div>
  );
}
