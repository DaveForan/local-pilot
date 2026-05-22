import type { SessionMeta } from '../protocol';
import { usePilot } from '../store';
import { Timeline } from './Timeline';
import { Composer } from './Composer';

/** The chat view — just the conversation. Session chrome lives in the drawer. */
export function ChatPane({ session }: { session: SessionMeta | null }) {
  const { events } = usePilot();

  if (!session) {
    return (
      <div className="pane-empty">
        <div className="pane-empty-inner">
          <span className="dot-logo big" />
          <h2>No session open</h2>
          <p>Open the menu with ☰ to pick a session or start a new one.</p>
        </div>
      </div>
    );
  }

  const list = events[session.id] ?? [];

  return (
    <div className="chat">
      <Timeline sessionId={session.id} events={list} status={session.status} />
      <Composer session={session} />
    </div>
  );
}
