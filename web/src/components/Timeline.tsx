import { useEffect, useMemo, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { SessionEvent, SessionStatus, ChatImage } from '../protocol';
import { PermissionCard } from './PermissionCard';
import { ActivityLog } from './ActivityLog';
import { TodoCard } from './TodoCard';
import { speak, stopSpeaking, speechOutputSupported } from '../speech';

type ActivityEvent = Extract<
  SessionEvent,
  { kind: 'tool_use' | 'tool_result' | 'thinking' | 'system' }
>;
type PermissionEvent = Extract<SessionEvent, { kind: 'permission' }>;
type ResultEvent = Extract<SessionEvent, { kind: 'result' }>;
type ToolUseEvent = Extract<SessionEvent, { kind: 'tool_use' }>;

/** One Claude turn: a user message and everything Claude did in response. */
export interface Turn {
  key: number;
  userText: string | null;
  /** Images the user attached to their message. */
  userImages: ChatImage[];
  /** Tool calls, results, thinking and system notes — hidden behind the log. */
  activity: ActivityEvent[];
  /** Assistant text blocks — shown as the visible response. */
  texts: string[];
  permissions: PermissionEvent[];
  /** Latest TodoWrite tool call in the turn — rendered inline as a checklist. */
  lastTodo: ToolUseEvent | null;
  result: ResultEvent | null;
}

/** Fold the flat event log into turns so each renders as one activity + reply. */
function groupTurns(events: SessionEvent[]): Turn[] {
  const turns: Turn[] = [];
  let cur: Turn | null = null;
  // Per-turn set of TodoWrite tool ids so their acknowledgement results stay
  // out of the generic activity log.
  let todoToolIds = new Set<string>();
  const open = (key: number): Turn => {
    cur = {
      key,
      userText: null,
      userImages: [],
      activity: [],
      texts: [],
      permissions: [],
      lastTodo: null,
      result: null,
    };
    todoToolIds = new Set<string>();
    turns.push(cur);
    return cur;
  };
  for (const e of events) {
    if (e.kind === 'user') {
      const t = open(e.seq);
      t.userText = e.text;
      t.userImages = e.images ?? [];
      continue;
    }
    const t = cur ?? open(e.seq);
    switch (e.kind) {
      case 'assistant':
        t.texts.push(e.text);
        break;
      case 'tool_use':
        if (e.name === 'TodoWrite') {
          t.lastTodo = e;
          todoToolIds.add(e.toolId);
        } else {
          t.activity.push(e);
        }
        break;
      case 'tool_result':
        if (todoToolIds.has(e.toolId)) break; // TodoWrite ack — shown via the card
        t.activity.push(e);
        break;
      case 'thinking':
      case 'system':
        t.activity.push(e);
        break;
      case 'permission':
        t.permissions.push(e);
        break;
      case 'result':
        t.result = e;
        break;
    }
  }
  return turns;
}

interface Props {
  sessionId: string;
  events: SessionEvent[];
  status: SessionStatus;
  /** When on, new replies are read aloud automatically. */
  voiceMode: boolean;
  /** Called once a reply has finished being read aloud. */
  onReplySpoken: () => void;
}

export function Timeline({ sessionId, events, status, voiceMode, onReplySpoken }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const [logKey, setLogKey] = useState<number | null>(null);
  const spokenRef = useRef<number>(-1);
  const turns = useMemo(() => groupTurns(events), [events]);
  // Look the open turn up by key each render so the log keeps updating live.
  const logTurn = logKey == null ? null : turns.find((t) => t.key === logKey) ?? null;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [events.length, status]);

  // Conversation mode: read each newly-completed reply aloud.
  useEffect(() => {
    if (!voiceMode) {
      spokenRef.current = -1;
      return;
    }
    const last = turns[turns.length - 1];
    if (!last?.result) return;
    const text = last.texts.join('\n\n').trim();
    if (spokenRef.current === -1) {
      // Just switched on — arm without re-reading the reply already shown.
      spokenRef.current = last.key;
      return;
    }
    if (last.key > spokenRef.current) {
      spokenRef.current = last.key;
      // If the turn had no spoken reply (tool-only completion), still hand
      // back to the conversation loop so the mic reopens.
      if (text) speak(text, onReplySpoken);
      else onReplySpoken();
    }
  }, [turns, voiceMode, onReplySpoken]);

  return (
    <div className="timeline">
      {events.length === 0 && (
        <div className="empty-hint center">Send a message to start the session.</div>
      )}
      {turns.map((turn, i) => (
        <TurnView
          key={turn.key}
          sessionId={sessionId}
          turn={turn}
          running={
            i === turns.length - 1 &&
            !turn.result &&
            (status === 'running' || status === 'awaiting_permission')
          }
          onOpenLog={() => setLogKey(turn.key)}
        />
      ))}
      <div ref={endRef} />
      {logTurn && <ActivityLog turn={logTurn} onClose={() => setLogKey(null)} />}
    </div>
  );
}

function TurnView({
  sessionId,
  turn,
  running,
  onOpenLog,
}: {
  sessionId: string;
  turn: Turn;
  running: boolean;
  onOpenLog: () => void;
}) {
  const toolCount = turn.activity.reduce((n, e) => (e.kind === 'tool_use' ? n + 1 : n), 0);
  const hasThinking = turn.activity.some((e) => e.kind === 'thinking');
  const showActivity = running || toolCount > 0 || hasThinking;
  const responseText = turn.texts.join('\n\n').trim();

  return (
    <>
      {turn.userText != null && (
        <div className="ev ev-user">
          <div className="bubble">
            {turn.userImages.length > 0 && (
              <div className="bubble-images">
                {turn.userImages.map((im, i) => (
                  <img
                    key={i}
                    src={`data:${im.mediaType};base64,${im.data}`}
                    alt="attachment"
                  />
                ))}
              </div>
            )}
            {turn.userText && <span className="bubble-text">{turn.userText}</span>}
          </div>
        </div>
      )}

      {showActivity && (
        <div className="ev">
          <ActivityBlock
            running={running}
            toolCount={toolCount}
            durationMs={turn.result?.durationMs ?? null}
            costUsd={turn.result?.costUsd ?? null}
            openable={turn.activity.length > 0}
            onOpen={onOpenLog}
          />
        </div>
      )}

      {turn.permissions.map((p) => (
        <PermissionCard key={p.seq} sessionId={sessionId} event={p} />
      ))}

      {turn.lastTodo && <TodoCard event={turn.lastTodo} />}

      {responseText && (
        <div className="ev ev-assistant">
          <div className="md">
            <Markdown remarkPlugins={[remarkGfm]}>{responseText}</Markdown>
          </div>
          <SpeakButton text={responseText} />
        </div>
      )}
    </>
  );
}

/** Reads a reply aloud — tap to play, tap again to stop. */
function SpeakButton({ text }: { text: string }) {
  const [speaking, setSpeaking] = useState(false);
  if (!speechOutputSupported()) return null;
  return (
    <button
      type="button"
      className="speak-btn"
      aria-label={speaking ? 'Stop reading' : 'Read aloud'}
      onClick={() => {
        if (speaking) {
          stopSpeaking();
          setSpeaking(false);
        } else {
          setSpeaking(true);
          speak(text, () => setSpeaking(false));
        }
      }}
    >
      {speaking ? '◼ Stop' : '🔊 Read aloud'}
    </button>
  );
}

/** The single block that stands in for the CLI's streaming command output. */
function ActivityBlock({
  running,
  toolCount,
  durationMs,
  costUsd,
  openable,
  onOpen,
}: {
  running: boolean;
  toolCount: number;
  durationMs: number | null;
  costUsd: number | null;
  openable: boolean;
  onOpen: () => void;
}) {
  const label = running
    ? 'Claude is working…'
    : toolCount > 0
      ? `Claude finished — used ${toolCount} command${toolCount === 1 ? '' : 's'}`
      : 'Claude finished';

  return (
    <button
      type="button"
      className={`activity-block ${running ? 'running' : 'done'}`}
      onClick={openable ? onOpen : undefined}
      disabled={!openable}
    >
      <span className="activity-icon">
        {running ? <span className="spinner" /> : <span className="activity-check">✓</span>}
      </span>
      <span className="activity-label">{label}</span>
      {!running && durationMs != null && (
        <span className="chip">{(durationMs / 1000).toFixed(1)}s</span>
      )}
      {!running && costUsd != null && <span className="chip">${costUsd.toFixed(4)}</span>}
      {openable && <span className="activity-open">View log ›</span>}
    </button>
  );
}
