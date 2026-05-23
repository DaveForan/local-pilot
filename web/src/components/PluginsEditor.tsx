import { useEffect, useState } from 'react';
import { api } from '../api';

type Plugin = { type: 'local'; path: string };

export function PluginsEditor() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .plugins()
      .then(setPlugins)
      .catch((e) => setErr(String(e)));
  }, []);

  const persist = async (next: Plugin[]): Promise<void> => {
    setSaving(true);
    setErr(null);
    try {
      await api.savePlugins(next);
      setPlugins(next);
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  };

  const add = (): void => {
    const path = draft.trim();
    if (!path) return;
    if (plugins.find((p) => p.path === path)) {
      setErr('That plugin is already in the list.');
      return;
    }
    setDraft('');
    void persist([...plugins, { type: 'local', path }]);
  };

  const remove = (path: string): void => {
    if (!window.confirm(`Remove plugin at "${path}"?`)) return;
    void persist(plugins.filter((p) => p.path !== path));
  };

  return (
    <div className="mcp-pane">
      <p className="settings-note">
        Local plugin directories the SDK loads into every session. A plugin can ship slash
        commands, agents, skills, and hooks. Edits take effect when the next session starts a
        turn.
      </p>
      <div className="mcp-list">
        {plugins.length === 0 && <div className="empty-hint">No plugins configured.</div>}
        {plugins.map((p) => (
          <div key={p.path} className="mcp-row">
            <div className="mcp-row-text">
              <div className="mcp-row-name">{p.path.split('/').pop() || p.path}</div>
              <div className="mcp-row-sub">{p.path}</div>
            </div>
            <button
              className="icon-btn"
              aria-label={`Remove ${p.path}`}
              onClick={() => remove(p.path)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="plugin-add">
        <input
          className="plugin-add-input"
          placeholder="/absolute/path/to/plugin"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button className="btn btn-accent" onClick={add} disabled={saving || !draft.trim()}>
          ＋ Add
        </button>
      </div>
      {err && <div className="form-err">{err}</div>}
    </div>
  );
}
