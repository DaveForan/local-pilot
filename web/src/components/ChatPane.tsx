import { useRef, useState } from 'react';
import type { SessionMeta } from '../protocol';
import { usePilot } from '../store';
import { Timeline } from './Timeline';
import { Composer, type ComposerHandle } from './Composer';

/** The chat view — just the conversation. Session chrome lives in the drawer. */
export function ChatPane({ session }: { session: SessionMeta | null }) {
  const { events, hasMore, loadingEarlier } = usePilot();
  const [voiceMode, setVoiceMode] = useState(false);
  const composerRef = useRef<ComposerHandle>(null);

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
      <Timeline
        sessionId={session.id}
        events={list}
        status={session.status}
        hasMore={hasMore[session.id] ?? false}
        loadingEarlier={loadingEarlier[session.id] ?? false}
        voiceMode={voiceMode}
        // When a reply finishes being read aloud, reopen the mic to continue.
        onReplySpoken={() => composerRef.current?.beginVoiceReply()}
      />
      <Composer
        ref={composerRef}
        session={session}
        voiceMode={voiceMode}
        onToggleVoiceMode={() => setVoiceMode((v) => !v)}
      />
    </div>
  );
}
