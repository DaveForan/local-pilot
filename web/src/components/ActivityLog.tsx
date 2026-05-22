import { useState } from 'react';
import { formatValue } from '../format';
import type { Turn } from './Timeline';

type ActivityEvent = Turn['activity'][number];

/**
 * Modal that opens from a turn's activity block — every command, file edit,
 * result and thought Claude ran during the turn, presented as a log. MCP
 * tool calls are clearly tagged.
 */
export function ActivityLog({ turn, onClose }: { turn: Turn; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <h3>Activity log</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close log">
            ✕
          </button>
        </div>
        <p className="settings-note">
          Everything Claude ran this turn — commands, file edits and results. Tap a row to
          expand it.
        </p>
        <div className="log">
          {turn.activity.length === 0 && (
            <div className="empty-hint">Nothing logged yet.</div>
          )}
          {turn.activity.map((e) => (
            <LogEntry key={e.seq} event={e} />
          ))}
        </div>
      </div>
    </div>
  );
}

function LogEntry({ event }: { event: ActivityEvent }) {
  switch (event.kind) {
    case 'system':
      return <div className="log-system">{event.text}</div>;
    case 'thinking':
      return <LogRow kind="thinking" summary="Thinking" body={event.text} />;
    case 'tool_use': {
      const mcp = event.name.startsWith('mcp__');
      return (
        <LogRow
          kind={mcp ? 'mcp' : 'tool'}
          tag={mcp ? 'MCP' : 'Tool'}
          summary={mcp ? mcpLabel(event.name) : event.name}
          body={formatValue(event.input)}
        />
      );
    }
    case 'tool_result':
      return (
        <LogRow
          kind={event.isError ? 'error' : 'result'}
          tag={event.isError ? 'Error' : 'Result'}
          summary={event.isError ? 'Tool error' : 'Tool result'}
          body={event.content || '(empty)'}
        />
      );
  }
  return null;
}

/** `mcp__server__some_tool` → `server · some_tool` */
function mcpLabel(name: string): string {
  const parts = name.split('__');
  return parts.length >= 3 ? `${parts[1]} · ${parts.slice(2).join('__')}` : name;
}

/** A collapsible log row — the dropdown for tool/MCP calls and results. */
function LogRow({
  kind,
  tag,
  summary,
  body,
}: {
  kind: string;
  tag?: string;
  summary: string;
  body: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`log-item log-${kind}`}>
      <button className="log-head" onClick={() => setOpen((v) => !v)}>
        <span className="caret">{open ? '▾' : '▸'}</span>
        {tag && <span className="log-tag">{tag}</span>}
        <span className="log-summary">{summary}</span>
      </button>
      {open && <pre className="code">{body}</pre>}
    </div>
  );
}
