import { useEffect, useState } from 'react';
import { api, type McpServer, type McpServers } from '../api';

/** Form-friendly working copy of one MCP server. */
interface Draft {
  name: string;
  transport: 'stdio' | 'http' | 'sse';
  command: string;
  argsText: string; // one argument per line
  envText: string; // KEY=value per line
  url: string;
  headersText: string; // KEY=value per line
}

const emptyDraft = (): Draft => ({
  name: '',
  transport: 'stdio',
  command: '',
  argsText: '',
  envText: '',
  url: '',
  headersText: '',
});

function recordToLines(rec?: Record<string, string>): string {
  return rec ? Object.entries(rec).map(([k, v]) => `${k}=${v}`).join('\n') : '';
}

function linesToRecord(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

function fromServer(name: string, s: McpServer): Draft {
  const d = emptyDraft();
  d.name = name;
  if ('url' in s) {
    d.transport = s.type;
    d.url = s.url;
    d.headersText = recordToLines(s.headers);
  } else {
    d.transport = 'stdio';
    d.command = s.command ?? '';
    d.argsText = (s.args ?? []).join('\n');
    d.envText = recordToLines(s.env);
  }
  return d;
}

function toServer(d: Draft): McpServer {
  if (d.transport === 'stdio') {
    const server: McpServer = { type: 'stdio', command: d.command.trim() };
    const args = d.argsText.split('\n').map((l) => l.trim()).filter(Boolean);
    if (args.length) server.args = args;
    const env = linesToRecord(d.envText);
    if (Object.keys(env).length) server.env = env;
    return server;
  }
  const server: McpServer = { type: d.transport, url: d.url.trim() };
  const headers = linesToRecord(d.headersText);
  if (Object.keys(headers).length) server.headers = headers;
  return server;
}

/** Visual editor for the MCP servers local-pilot layers onto every session. */
export function McpEditor() {
  const [servers, setServers] = useState<McpServers | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  /** Original name of the server being edited — null when adding a new one. */
  const [origName, setOrigName] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.mcp().then(setServers).catch((e) => setErr(String(e)));
  }, []);

  const persist = async (next: McpServers): Promise<void> => {
    setSaving(true);
    setErr(null);
    try {
      await api.saveMcp(next);
      setServers(next);
      setEditing(null);
      setOrigName(null);
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = (name: string): void => {
    if (!servers || !window.confirm(`Remove MCP server "${name}"?`)) return;
    const next = { ...servers };
    delete next[name];
    void persist(next);
  };

  const saveDraft = (): void => {
    if (!servers || !editing) return;
    const name = editing.name.trim();
    if (!name) return setErr('Server name is required.');
    if (editing.transport === 'stdio' && !editing.command.trim()) {
      return setErr('Command is required for a stdio server.');
    }
    if (editing.transport !== 'stdio' && !editing.url.trim()) {
      return setErr('URL is required for an HTTP/SSE server.');
    }
    if (name !== origName && servers[name]) {
      return setErr(`A server named "${name}" already exists.`);
    }
    const next = { ...servers };
    if (origName && origName !== name) delete next[origName];
    next[name] = toServer(editing);
    void persist(next);
  };

  if (err && !servers) return <div className="form-err">{err}</div>;
  if (!servers) return <div className="empty-hint">Loading…</div>;

  if (editing) {
    return (
      <McpForm
        draft={editing}
        isNew={origName === null}
        err={err}
        saving={saving}
        onChange={setEditing}
        onCancel={() => {
          setEditing(null);
          setOrigName(null);
          setErr(null);
        }}
        onSave={saveDraft}
      />
    );
  }

  const names = Object.keys(servers).sort();
  return (
    <div className="mcp-pane">
      <p className="settings-note">
        These MCP servers are added to every Claude Code session local-pilot starts. They take
        effect the next time a session begins a turn.
      </p>
      <div className="mcp-list">
        {names.length === 0 && <div className="empty-hint">No MCP servers configured.</div>}
        {names.map((name) => {
          const s = servers[name];
          const summary = 'url' in s ? `${s.type} · ${s.url}` : `stdio · ${s.command}`;
          return (
            <div key={name} className="mcp-row">
              <div className="mcp-row-text">
                <div className="mcp-row-name">{name}</div>
                <div className="mcp-row-sub">{summary}</div>
              </div>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setEditing(fromServer(name, s));
                  setOrigName(name);
                  setErr(null);
                }}
              >
                Edit
              </button>
              <button className="icon-btn" aria-label={`Remove ${name}`} onClick={() => remove(name)}>
                ✕
              </button>
            </div>
          );
        })}
      </div>
      {err && <div className="form-err">{err}</div>}
      <button
        className="btn btn-accent"
        onClick={() => {
          setEditing(emptyDraft());
          setOrigName(null);
          setErr(null);
        }}
      >
        ＋ Add MCP server
      </button>
    </div>
  );
}

interface FormProps {
  draft: Draft;
  isNew: boolean;
  err: string | null;
  saving: boolean;
  onChange: (d: Draft) => void;
  onCancel: () => void;
  onSave: () => void;
}

function McpForm({ draft, isNew, err, saving, onChange, onCancel, onSave }: FormProps) {
  const set = (patch: Partial<Draft>): void => onChange({ ...draft, ...patch });

  return (
    <div className="mcp-form">
      <h4>{isNew ? 'Add MCP server' : `Edit “${draft.name}”`}</h4>

      <label className="field">
        <span>Name</span>
        <input
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="e.g. playwright"
        />
      </label>

      <label className="field">
        <span>Transport</span>
        <select
          value={draft.transport}
          onChange={(e) => set({ transport: e.target.value as Draft['transport'] })}
        >
          <option value="stdio">stdio — local command</option>
          <option value="http">HTTP — remote</option>
          <option value="sse">SSE — remote</option>
        </select>
      </label>

      {draft.transport === 'stdio' ? (
        <>
          <label className="field">
            <span>Command</span>
            <input
              value={draft.command}
              onChange={(e) => set({ command: e.target.value })}
              placeholder="npx"
            />
          </label>
          <label className="field">
            <span>Arguments — one per line</span>
            <textarea
              className="snippet-mgr-input"
              rows={3}
              value={draft.argsText}
              onChange={(e) => set({ argsText: e.target.value })}
              placeholder={'-y\n@modelcontextprotocol/server-name'}
            />
          </label>
          <label className="field">
            <span>Environment — KEY=value per line</span>
            <textarea
              className="snippet-mgr-input"
              rows={2}
              value={draft.envText}
              onChange={(e) => set({ envText: e.target.value })}
              placeholder="API_KEY=…"
            />
          </label>
        </>
      ) : (
        <>
          <label className="field">
            <span>URL</span>
            <input
              value={draft.url}
              onChange={(e) => set({ url: e.target.value })}
              placeholder="https://example.com/mcp"
            />
          </label>
          <label className="field">
            <span>Headers — KEY=value per line</span>
            <textarea
              className="snippet-mgr-input"
              rows={2}
              value={draft.headersText}
              onChange={(e) => set({ headersText: e.target.value })}
              placeholder="Authorization=Bearer …"
            />
          </label>
        </>
      )}

      {err && <div className="form-err">{err}</div>}

      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-accent" onClick={onSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save server'}
        </button>
      </div>
    </div>
  );
}
