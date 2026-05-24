import { useState, type ReactNode } from 'react';
import { diffLines } from 'diff';
import { formatValue } from '../format';
import type { ChatImage } from '../protocol';
import type { Turn } from './Timeline';
import { LightboxImage } from './ImageLightbox';
import { useEscapeClose } from '../useModal';

type ActivityEvent = Turn['activity'][number];

/**
 * Modal that opens from a turn's activity block — every command, file edit,
 * result and thought Claude ran during the turn, presented as a log. MCP
 * tool calls are clearly tagged.
 */
export function ActivityLog({ turn, onClose }: { turn: Turn; onClose: () => void }) {
  useEscapeClose(onClose);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal modal-log"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Activity log"
      >
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
      // File-editing tools get a proper diff view instead of JSON.
      if (event.name === 'Edit' || event.name === 'Write' || event.name === 'MultiEdit') {
        return <FileEditRow event={event} />;
      }
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
    case 'tool_result': {
      const images = event.images ?? [];
      const summary = event.isError
        ? 'Tool error'
        : images.length > 0
          ? `Tool result · ${images.length} image${images.length === 1 ? '' : 's'}`
          : 'Tool result';
      return (
        <LogRow
          kind={event.isError ? 'error' : 'result'}
          tag={event.isError ? 'Error' : 'Result'}
          summary={summary}
          body={event.content || '(empty)'}
          images={images}
        />
      );
    }
  }
  return null;
}

/** `mcp__server__some_tool` → `server · some_tool` */
function mcpLabel(name: string): string {
  const parts = name.split('__');
  return parts.length >= 3 ? `${parts[1]} · ${parts.slice(2).join('__')}` : name;
}

interface EditInput {
  file_path?: string;
  old_string?: string;
  new_string?: string;
  content?: string;
  edits?: { old_string?: string; new_string?: string }[];
}

/** Diff/preview view for Edit, Write and MultiEdit tool calls. */
function FileEditRow({
  event,
}: {
  event: Extract<ActivityEvent, { kind: 'tool_use' }>;
}) {
  const [open, setOpen] = useState(false);
  const input = (event.input as EditInput | null) ?? {};
  const filePath = input.file_path ?? '(unknown file)';

  const isWrite = event.name === 'Write';
  const isMulti = event.name === 'MultiEdit';
  const editCount = isMulti ? (input.edits?.length ?? 0) : 1;
  const tag = event.name;
  const summary = isWrite
    ? `${filePath} · new file`
    : isMulti
      ? `${filePath} · ${editCount} edit${editCount === 1 ? '' : 's'}`
      : filePath;

  return (
    <div className="log-item log-edit">
      <button className="log-head" onClick={() => setOpen((v) => !v)}>
        <span className="caret">{open ? '▾' : '▸'}</span>
        <span className="log-tag">{tag}</span>
        <span className="log-summary">{summary}</span>
      </button>
      {open && (
        <div className="file-diff-wrap">
          {isWrite ? (
            <DiffBlock added={input.content ?? ''} removed="" />
          ) : isMulti ? (
            (input.edits ?? []).map((ed, i) => (
              <DiffBlock
                key={i}
                added={ed.new_string ?? ''}
                removed={ed.old_string ?? ''}
              />
            ))
          ) : (
            <DiffBlock added={input.new_string ?? ''} removed={input.old_string ?? ''} />
          )}
        </div>
      )}
    </div>
  );
}

/** Render a unified-style diff between two strings. */
function DiffBlock({ added, removed }: { added: string; removed: string }): ReactNode {
  const parts = diffLines(removed, added);
  const lines: { cls: string; prefix: string; text: string }[] = [];
  for (const p of parts) {
    const cls = p.added ? 'diff-add' : p.removed ? 'diff-del' : 'diff-eq';
    const prefix = p.added ? '+' : p.removed ? '-' : ' ';
    const body = p.value.endsWith('\n') ? p.value.slice(0, -1) : p.value;
    for (const line of body.split('\n')) lines.push({ cls, prefix, text: line });
  }
  return (
    <pre className="file-diff">
      {lines.map((l, i) => (
        <div key={i} className={l.cls}>
          <span className="diff-prefix">{l.prefix}</span>
          <span className="diff-line">{l.text}</span>
        </div>
      ))}
    </pre>
  );
}

/** A collapsible log row — the dropdown for tool/MCP calls and results.
 *  Any images (e.g. screenshots) show straight away; text is behind the caret. */
function LogRow({
  kind,
  tag,
  summary,
  body,
  images,
}: {
  kind: string;
  tag?: string;
  summary: string;
  body: string;
  images?: ChatImage[];
}) {
  const [open, setOpen] = useState(false);
  const imgs = images ?? [];
  return (
    <div className={`log-item log-${kind}`}>
      <button className="log-head" onClick={() => setOpen((v) => !v)}>
        <span className="caret">{open ? '▾' : '▸'}</span>
        {tag && <span className="log-tag">{tag}</span>}
        <span className="log-summary">{summary}</span>
      </button>
      {imgs.length > 0 && (
        <div className="log-images">
          {imgs.map((im, i) => (
            <LightboxImage
              key={i}
              src={`data:${im.mediaType};base64,${im.data}`}
              alt="tool screenshot"
            />
          ))}
        </div>
      )}
      {open && <pre className="code">{body}</pre>}
    </div>
  );
}
