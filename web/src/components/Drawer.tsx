import { useEffect, useState } from 'react';
import type { SessionMeta, SessionEvent, PermissionMode, AccountInfo } from '../protocol';
import type { ConnectionState } from '../store';
import { store } from '../store';
import { relativeTime, shortPath } from '../format';
import { STATUS } from './status';
import type { Theme } from '../theme';
import { api } from '../api';

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
  activeModel: string | null;
  /** Events of the active session — for cost/duration totals. */
  activeEvents: SessionEvent[];
  connected: boolean;
  /** Fine-grained WS state — used to differentiate retry / unreachable / auth. */
  conn: ConnectionState;
  retryCount: number;
  theme: Theme;
  onSelect: (id: string) => void;
  onNew: () => void;
  onOpenSettings: () => void;
  onToggleTheme: () => void;
  onClose: () => void;
}

interface Totals {
  durationMs: number;
  costUsd: number;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  haveTokens: boolean;
}

function totalsFromEvents(events: SessionEvent[]): Totals {
  let durationMs = 0;
  let costUsd = 0;
  let turns = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreateTokens = 0;
  let haveTokens = false;
  for (const e of events) {
    if (e.kind !== 'result') continue;
    turns += 1;
    if (typeof e.durationMs === 'number') durationMs += e.durationMs;
    if (typeof e.costUsd === 'number') costUsd += e.costUsd;
    if (e.tokens) {
      haveTokens = true;
      inputTokens += e.tokens.input;
      outputTokens += e.tokens.output;
      cacheReadTokens += e.tokens.cacheRead;
      cacheCreateTokens += e.tokens.cacheCreate;
    }
  }
  return {
    durationMs,
    costUsd,
    turns,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreateTokens,
    haveTokens,
  };
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${s}s`;
}

function connStatusLabel(conn: ConnectionState, retryCount: number): string {
  switch (conn) {
    case 'open':
      return 'Connected';
    case 'connecting':
      return 'Connecting…';
    case 'retrying':
      return retryCount > 1 ? `Reconnecting (try ${retryCount})…` : 'Reconnecting…';
    case 'unreachable':
      return `Server unreachable (${retryCount} attempts)`;
    case 'auth_expired':
      return 'Session expired';
  }
}

function connStatusTooltip(conn: ConnectionState, retryCount: number): string {
  switch (conn) {
    case 'open':
      return 'Live WebSocket to the server';
    case 'connecting':
      return 'Opening the WebSocket…';
    case 'retrying':
      return `WebSocket dropped — retrying with backoff (attempt ${retryCount})`;
    case 'unreachable':
      return 'Multiple consecutive failures — the server may be down or unreachable over your tailnet.';
    case 'auth_expired':
      return 'Server rejected the cookie — sign in again to refresh it.';
  }
}

function fmtCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/** Best-effort context-window size for a given Claude model id.
 *  All current Claude 4.x models default to 200K; the 1M beta is opt-in. */
function contextWindowFor(model: string | null): number {
  if (!model) return 200_000;
  if (model.startsWith('claude-haiku-')) return 200_000;
  if (model.startsWith('claude-sonnet-')) return 200_000;
  if (model.startsWith('claude-opus-')) return 200_000;
  return 200_000;
}

/** Sum of every token kind that occupies the model's prompt window. */
function currentContextTokens(events: SessionEvent[]): number | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind === 'result' && e.tokens) {
      return e.tokens.input + e.tokens.cacheRead + e.tokens.cacheCreate;
    }
  }
  return null;
}

export function Drawer({
  open,
  sessions,
  activeId,
  active,
  activeModel,
  activeEvents,
  connected,
  conn,
  retryCount,
  theme,
  onSelect,
  onNew,
  onOpenSettings,
  onToggleTheme,
  onClose,
}: Props) {
  const [filter, setFilter] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [account, setAccount] = useState<AccountInfo | null>(null);

  useEffect(() => {
    if (!open) return;
    api
      .account()
      .then((r) => setAccount(r.account))
      .catch(() => setAccount(null));
  }, [open]);

  const filtered = filter.trim()
    ? sessions.filter((s) => {
        const q = filter.trim().toLowerCase();
        return s.title.toLowerCase().includes(q) || s.cwd.toLowerCase().includes(q);
      })
    : sessions;

  const totals = active ? totalsFromEvents(activeEvents) : null;
  const ctxUsed = active ? currentContextTokens(activeEvents) : null;
  const ctxLimit = contextWindowFor(activeModel);
  const ctxPct = ctxUsed != null ? Math.min(100, Math.round((ctxUsed / ctxLimit) * 100)) : 0;
  const ctxWarn = ctxPct >= 80;

  const startRename = (): void => {
    if (!active) return;
    setRenameValue(active.title);
    setRenaming(true);
  };
  const commitRename = (): void => {
    const next = renameValue.trim();
    if (active && next && next !== active.title) store.rename(active.id, next);
    setRenaming(false);
  };

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
          <input
            className="drawer-filter"
            type="search"
            placeholder="Filter sessions…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="session-list">
            {sessions.length === 0 && <div className="empty-hint">No sessions yet.</div>}
            {sessions.length > 0 && filtered.length === 0 && (
              <div className="empty-hint">No sessions match.</div>
            )}
            {filtered.map((s) => {
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
              {renaming ? (
                <input
                  className="cs-title-input"
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitRename();
                    } else if (e.key === 'Escape') {
                      setRenaming(false);
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="cs-title"
                  onClick={startRename}
                  title="Tap to rename"
                >
                  {active.title}
                </button>
              )}
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
              {active.outputStyle && (
                <div
                  className="cs-row"
                  title="Change with the /output-style slash command"
                >
                  <span>Output style</span>
                  <span className="cs-mono">{active.outputStyle}</span>
                </div>
              )}
              {ctxUsed != null && (
                <div className="cs-context" title="Current prompt size vs. the model's context window. Approaching 100% triggers compaction.">
                  <div className="cs-context-row">
                    <span>Context</span>
                    <span className="cs-mono">
                      {fmtCount(ctxUsed)} / {fmtCount(ctxLimit)} · {ctxPct}%
                    </span>
                  </div>
                  <div className="cs-context-bar">
                    <div
                      className={`cs-context-fill ${ctxWarn ? 'warn' : ''}`}
                      style={{ width: `${ctxPct}%` }}
                    />
                  </div>
                </div>
              )}
              {totals && totals.turns > 0 && (
                <>
                  <div className="cs-row">
                    <span>Turns</span>
                    <span>{totals.turns}</span>
                  </div>
                  <div className="cs-row">
                    <span>Total time</span>
                    <span className="cs-mono">{fmtDuration(totals.durationMs)}</span>
                  </div>
                  <div className="cs-row" title="What this usage would cost at API rates. Pro / Max subscribers are not actually billed this — the subscription covers it.">
                    <span>Cost (API equiv.)</span>
                    <span className="cs-mono">${totals.costUsd.toFixed(4)}</span>
                  </div>
                  {totals.haveTokens && (
                    <>
                      <div className="cs-row">
                        <span>Input tokens</span>
                        <span className="cs-mono">{fmtCount(totals.inputTokens)}</span>
                      </div>
                      <div className="cs-row">
                        <span>Output tokens</span>
                        <span className="cs-mono">{fmtCount(totals.outputTokens)}</span>
                      </div>
                      <div
                        className="cs-row"
                        title="Cache reads are ~10% of the normal input price; cache writes ~125%."
                      >
                        <span>Cache (read / write)</span>
                        <span className="cs-mono">
                          {fmtCount(totals.cacheReadTokens)} / {fmtCount(totals.cacheCreateTokens)}
                        </span>
                      </div>
                    </>
                  )}
                </>
              )}
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
              <a
                className="btn btn-ghost drawer-export"
                href={api.exportUrl(active.id)}
                download={`${active.title || 'session'}.md`}
              >
                Export transcript
              </a>
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
          {account && (account.email || account.organization) && (
            <div className="drawer-account">
              {account.email && <div className="drawer-account-email">{account.email}</div>}
              <div className="drawer-account-sub">
                {[account.organization, account.subscriptionType].filter(Boolean).join(' · ')}
              </div>
            </div>
          )}
          <button className="drawer-nav-item" onClick={onOpenSettings}>
            <span className="drawer-nav-icon">⚙</span> Settings
          </button>
          <button className="drawer-nav-item" onClick={onToggleTheme}>
            <span className="drawer-nav-icon">{theme === 'dark' ? '☀' : '☾'}</span>
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          <button
            className="drawer-nav-item"
            onClick={() => {
              void api.logout().finally(() => location.reload());
            }}
          >
            <span className="drawer-nav-icon">⎋</span> Sign out
          </button>
          <div
            className={`conn conn-${conn}`}
            title={connStatusTooltip(conn, retryCount)}
          >
            <span className="conn-dot" />
            {connStatusLabel(conn, retryCount)}
            {conn === 'auth_expired' && (
              <button
                className="conn-relogin"
                onClick={() => {
                  void api.logout().finally(() => location.reload());
                }}
              >
                Sign in again
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
