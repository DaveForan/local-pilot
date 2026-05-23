import { useEffect, useState } from 'react';
import { api } from '../api';

interface HookDoc {
  short: string;
  long: string;
}

/** Short + long descriptions for every supported hook event. */
const HOOK_DOCS: Record<string, HookDoc> = {
  PreToolUse: {
    short: 'before any tool runs',
    long: "Receives the tool name + input. Print JSON like {\"decision\":\"block\",\"reason\":\"…\"} to veto, or {\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\"}}.",
  },
  PostToolUse: {
    short: 'after any tool returns',
    long: "Runs once a tool finishes. Useful for auto-formatters: e.g. `prettier --write \"$file\"` after an Edit.",
  },
  UserPromptSubmit: {
    short: 'when you send a message',
    long: "Fires before your prompt reaches Claude. Print {\"hookSpecificOutput\":{\"hookEventName\":\"UserPromptSubmit\",\"additionalContext\":\"…\"}} to inject context.",
  },
  SessionStart: {
    short: 'when a session boots',
    long: 'Fires on startup / resume / clear / compact. Source is in the JSON payload.',
  },
  SessionEnd: {
    short: 'when a session ends',
    long: 'Fires once, with the exit reason.',
  },
  Stop: {
    short: 'when Claude finishes a turn',
    long: 'Fires when Claude stops responding. Useful for "done" sounds or desktop notifications.',
  },
  PreCompact: {
    short: 'before history is compacted',
    long: 'Fires when the SDK is about to summarize old turns. Trigger is auto or manual.',
  },
  Notification: {
    short: 'when Claude sends a notification',
    long: 'Fires for SDK-level notifications (e.g. waiting for permission).',
  },
};

export function HooksEditor() {
  const [events, setEvents] = useState<string[]>([]);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState(false);

  useEffect(() => {
    api
      .hooks()
      .then((r) => {
        setEvents(r.events);
        setConfig(r.config);
      })
      .catch((e) => setErr(String(e)));
  }, []);

  const save = async (): Promise<void> => {
    setSaving(true);
    setErr(null);
    try {
      await api.saveHooks(config);
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 2000);
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mcp-pane">
      <p className="settings-note">
        Shell commands wired into the SDK's hook events. Each command receives the hook payload
        on stdin as JSON; whatever it prints on stdout — if it parses as JSON — becomes the
        structured response. Takes effect the next time a session starts a turn.
      </p>
      <div className="hooks-list">
        {events.map((ev) => {
          const doc = HOOK_DOCS[ev] ?? { short: '', long: '' };
          return (
            <div key={ev} className="hook-row">
              <div className="hook-row-head">
                <span className="hook-name">{ev}</span>
                <span className="hook-when">{doc.short}</span>
              </div>
              <textarea
                className="hook-cmd"
                placeholder="(no hook)"
                rows={2}
                value={config[ev] ?? ''}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, [ev]: e.target.value }))
                }
              />
              <div className="hook-doc">{doc.long}</div>
            </div>
          );
        })}
      </div>
      {err && <div className="form-err">{err}</div>}
      <div className="settings-actions">
        {savedToast && <span className="saved-toast">Saved</span>}
        <button className="btn btn-accent" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save hooks'}
        </button>
      </div>
    </div>
  );
}
