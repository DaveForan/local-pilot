import { useEffect, useState } from 'react';
import { api, type SkillInfo } from '../api';
import { McpEditor } from './McpEditor';

type Tab = 'mcp' | 'skills';

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
        </div>

        {tab === 'mcp' ? <McpEditor /> : <SkillsList />}
      </div>
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
