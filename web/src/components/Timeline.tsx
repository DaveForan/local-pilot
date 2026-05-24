import { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionEvent, SessionStatus, ChatImage } from '../protocol';
import { PermissionCard } from './PermissionCard';
import { ActivityLog } from './ActivityLog';
import { TodoCard } from './TodoCard';
import { Reply } from './Reply';
import { LightboxImage } from './ImageLightbox';
import { RewindDialog } from './RewindDialog';
import { speak, stopSpeaking, speechOutputSupported } from '../speech';

type ActivityEvent = Extract<
  SessionEvent,
  { kind: 'tool_use' | 'tool_result' | 'thinking' | 'system' }
>;
type PermissionEvent = Extract<SessionEvent, { kind: 'permission' }>;
type ResultEvent = Extract<SessionEvent, { kind: 'result' }>;
type ToolUseEvent = Extract<SessionEvent, { kind: 'tool_use' }>;
type CompactionEvent = Extract<SessionEvent, { kind: 'compaction' }>;

/** A timeline entry is either a normal turn or a compaction divider. */
type TimelineItem = (Turn & { itemKind: 'turn' }) | (CompactionEvent & { itemKind: 'compaction' });

/** One Claude turn: a user message and everything Claude did in response. */
export interface Turn {
  key: number;
  userText: string | null;
  /** Images the user attached to their message. */
  userImages: ChatImage[];
  /** SDK-assigned uuid for the user message — needed to rewind to this turn. */
  userUuid: string | null;
  /** Tool calls, results, thinking and system notes — hidden behind the log. */
  activity: ActivityEvent[];
  /** Assistant text blocks — shown as the visible response. */
  texts: string[];
  permissions: PermissionEvent[];
  /** Latest TodoWrite tool call in the turn — rendered inline as a checklist. */
  lastTodo: ToolUseEvent | null;
  result: ResultEvent | null;
}

/** Fold the flat event log into turns *and* compaction dividers so the UI
 *  renders both in order. */
function groupTimeline(events: SessionEvent[]): TimelineItem[] {
  // Items are emitted in event order: a fresh Turn object for every user
  // message (or the first non-user event before any user), and a divider
  // record whenever the SDK reports a compaction.
  const items: TimelineItem[] = [];
  let cur: Turn | null = null;
  // Per-turn set of TodoWrite tool ids so their acknowledgement results stay
  // out of the generic activity log.
  let todoToolIds = new Set<string>();
  // Per-turn set of elicitation tool ids (AskUserQuestion etc.) — their
  // tool_use + tool_result are visually redundant with the permission card
  // and would otherwise render as "Tool error" with the raw answer JSON
  // (the SDK has no "respond with answer" behavior, so 'answer' is delivered
  // as a deny.message which it labels as an error). The permission card
  // already shows the question + chosen answer cleanly.
  let elicitationToolIds = new Set<string>();
  const ELICITATION_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode', 'EnterPlanMode']);
  const open = (key: number): Turn => {
    cur = {
      key,
      userText: null,
      userImages: [],
      userUuid: null,
      activity: [],
      texts: [],
      permissions: [],
      lastTodo: null,
      result: null,
    };
    todoToolIds = new Set<string>();
    elicitationToolIds = new Set<string>();
    // We push the Turn *object* into items; later mutations on that same
    // object (text, activity, etc.) stay visible because items holds a ref.
    items.push(Object.assign(cur, { itemKind: 'turn' as const }) as TimelineItem);
    return cur;
  };
  for (const e of events) {
    if (e.kind === 'compaction') {
      // Compactions sit between turns — close the current one and emit a
      // divider so the user sees their history was summarized.
      cur = null;
      items.push({ ...e, itemKind: 'compaction' });
      continue;
    }
    if (e.kind === 'user') {
      const t = open(e.seq);
      t.userText = e.text;
      t.userImages = e.images ?? [];
      t.userUuid = e.userUuid ?? null;
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
        } else if (ELICITATION_TOOLS.has(e.name)) {
          // The permission card represents this fully — keep it out of activity.
          elicitationToolIds.add(e.toolId);
        } else {
          t.activity.push(e);
        }
        break;
      case 'tool_result':
        if (todoToolIds.has(e.toolId)) break; // TodoWrite ack — shown via the card
        if (elicitationToolIds.has(e.toolId)) break; // elicitation answer — shown via the card
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
  return items;
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

const INITIAL_VISIBLE_TURNS = 50;
const MORE_PER_CLICK = 50;

export function Timeline({ sessionId, events, status, voiceMode, onReplySpoken }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const [logKey, setLogKey] = useState<number | null>(null);
  const [rewindTarget, setRewindTarget] = useState<{
    userUuid: string;
    userText: string;
  } | null>(null);
  const [visible, setVisible] = useState(INITIAL_VISIBLE_TURNS);
  const spokenRef = useRef<number>(-1);
  const items = useMemo(() => groupTimeline(events), [events]);
  const turns = useMemo(
    () => items.filter((i): i is TimelineItem & { itemKind: 'turn' } => i.itemKind === 'turn'),
    [items],
  );
  // Look the open turn up by key each render so the log keeps updating live.
  const logTurn = logKey == null ? null : turns.find((t) => t.key === logKey) ?? null;

  // For long sessions, only keep the most recent N items in the DOM. The
  // "Load earlier" header expands the window on demand.
  const hiddenCount = Math.max(0, items.length - visible);
  const shownItems = hiddenCount > 0 ? items.slice(hiddenCount) : items;
  const lastTurnKey = turns.length > 0 ? turns[turns.length - 1].key : null;

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
      {hiddenCount > 0 && (
        <button
          className="load-earlier"
          onClick={() => setVisible((v) => v + MORE_PER_CLICK)}
        >
          Load {Math.min(hiddenCount, MORE_PER_CLICK)} earlier
          {hiddenCount > MORE_PER_CLICK ? ` of ${hiddenCount}` : ''}
        </button>
      )}
      {shownItems.map((item) => {
        if (item.itemKind === 'compaction') {
          return <CompactionDivider key={`c-${item.seq}`} event={item} />;
        }
        const isLast = item.key === lastTurnKey;
        return (
          <TurnView
            key={item.key}
            sessionId={sessionId}
            turn={item}
            running={
              isLast &&
              !item.result &&
              (status === 'running' || status === 'awaiting_permission')
            }
            onOpenLog={() => setLogKey(item.key)}
            onRewind={
              item.userUuid
                ? () =>
                    setRewindTarget({
                      userUuid: item.userUuid!,
                      userText: item.userText ?? '',
                    })
                : null
            }
          />
        );
      })}
      <div ref={endRef} />
      {logTurn && <ActivityLog turn={logTurn} onClose={() => setLogKey(null)} />}
      {rewindTarget && (
        <RewindDialog
          sessionId={sessionId}
          userUuid={rewindTarget.userUuid}
          userText={rewindTarget.userText}
          onClose={() => setRewindTarget(null)}
        />
      )}
    </div>
  );
}

function TurnView({
  sessionId,
  turn,
  running,
  onOpenLog,
  onRewind,
}: {
  sessionId: string;
  turn: Turn;
  running: boolean;
  onOpenLog: () => void;
  /** Present when the SDK's user uuid is known — clicking opens the rewind dialog. */
  onRewind: (() => void) | null;
}) {
  const toolCount = turn.activity.reduce((n, e) => (e.kind === 'tool_use' ? n + 1 : n), 0);
  const hasThinking = turn.activity.some((e) => e.kind === 'thinking');
  const showActivity = running || toolCount > 0 || hasThinking;
  const responseText = turn.texts.join('\n\n').trim();
  // Surface any images tools produced (screenshots, image Reads, generated
  // images) inline — otherwise they'd be buried in the activity-log modal.
  const turnImages: ChatImage[] = turn.activity.flatMap((e) =>
    e.kind === 'tool_result' && e.images ? e.images : [],
  );

  return (
    <>
      {turn.userText != null && (
        <div className="ev ev-user" data-turn-key={turn.key}>
          <div className="bubble">
            {turn.userImages.length > 0 && (
              <div className="bubble-images">
                {turn.userImages.map((im, i) => (
                  <LightboxImage
                    key={i}
                    src={`data:${im.mediaType};base64,${im.data}`}
                    alt="attachment"
                  />
                ))}
              </div>
            )}
            {turn.userText && <span className="bubble-text">{turn.userText}</span>}
          </div>
          {onRewind && (
            <button
              type="button"
              className="rewind-btn"
              onClick={onRewind}
              title="Restore tracked files to their state at this turn"
            >
              ↶ Rewind files to here
            </button>
          )}
        </div>
      )}

      {showActivity && (
        <div className="ev">
          <ActivityBlock
            running={running}
            toolCount={toolCount}
            currentTool={running ? latestToolName(turn.activity) : null}
            durationMs={turn.result?.durationMs ?? null}
            costUsd={turn.result?.costUsd ?? null}
            tokens={turn.result?.tokens ?? null}
            openable={turn.activity.length > 0}
            onOpen={onOpenLog}
          />
        </div>
      )}

      {turnImages.length > 0 && (
        <div className="ev ev-tool-images">
          <div className="tool-image-strip" aria-label="Images produced this turn">
            {turnImages.map((im, i) => (
              <LightboxImage
                key={i}
                src={`data:${im.mediaType};base64,${im.data}`}
                alt="tool image"
              />
            ))}
          </div>
        </div>
      )}

      {turn.permissions.map((p) => (
        <PermissionCard key={p.seq} sessionId={sessionId} event={p} />
      ))}

      {turn.lastTodo && <TodoCard event={turn.lastTodo} />}

      {responseText && (
        <div className="ev ev-assistant">
          <div className="md">
            <Reply>{responseText}</Reply>
          </div>
          <SpeakButton text={responseText} />
        </div>
      )}
    </>
  );
}

/** "mcp__server__tool" → "server · tool" for the activity-block indicator. */
function prettyToolName(name: string): string {
  if (!name.startsWith('mcp__')) return name;
  const parts = name.split('__');
  return parts.length >= 3 ? `${parts[1]} · ${parts.slice(2).join('__')}` : name;
}

/** Most recent tool name in the turn, for the "Running X…" indicator. */
function latestToolName(activity: ActivityEvent[]): string | null {
  for (let i = activity.length - 1; i >= 0; i--) {
    const e = activity[i];
    if (e.kind === 'tool_use') return prettyToolName(e.name);
  }
  return null;
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

function fmtCompactTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function CompactionDivider({ event }: { event: CompactionEvent }) {
  const triggerLabel = event.trigger === 'auto' ? 'auto-compacted' : 'compacted';
  return (
    <div className="compaction-divider" role="separator" aria-label="History compacted">
      <span className="compaction-line" />
      <span className="compaction-label">
        ↻ History {triggerLabel} · {fmtCompactTokens(event.preTokens)} tokens before
      </span>
      <span className="compaction-line" />
    </div>
  );
}

function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/** The single block that stands in for the CLI's streaming command output. */
function ActivityBlock({
  running,
  toolCount,
  currentTool,
  durationMs,
  costUsd,
  tokens,
  openable,
  onOpen,
}: {
  running: boolean;
  toolCount: number;
  currentTool: string | null;
  durationMs: number | null;
  costUsd: number | null;
  tokens: { input: number; output: number; cacheRead: number; cacheCreate: number } | null;
  openable: boolean;
  onOpen: () => void;
}) {
  const label = running
    ? currentTool
      ? `Running ${currentTool}…`
      : 'Claude is working…'
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
      {!running && tokens && (
        <span
          className="chip"
          title={`Input ${tokens.input.toLocaleString()} · Output ${tokens.output.toLocaleString()} · Cache read ${tokens.cacheRead.toLocaleString()} · Cache write ${tokens.cacheCreate.toLocaleString()}`}
        >
          ↑{fmtTokens(tokens.input + tokens.cacheRead + tokens.cacheCreate)} ↓
          {fmtTokens(tokens.output)}
        </span>
      )}
      {!running && costUsd != null && (
        <span
          className="chip"
          title="API-equivalent cost. Pro / Max subscriptions cover this — you are not billed it."
        >
          ${costUsd.toFixed(4)}
        </span>
      )}
      {openable && <span className="activity-open">View log ›</span>}
    </button>
  );
}
