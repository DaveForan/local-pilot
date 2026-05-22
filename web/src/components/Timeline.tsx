import { useEffect, useRef } from 'react';
import type { SessionEvent, SessionStatus } from '../protocol';
import { EventItem } from './EventItem';

interface Props {
  sessionId: string;
  events: SessionEvent[];
  status: SessionStatus;
}

export function Timeline({ sessionId, events, status }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [events.length, status]);

  return (
    <div className="timeline">
      {events.length === 0 && (
        <div className="empty-hint center">Send a message to start the session.</div>
      )}
      {events.map((e) => (
        <EventItem key={e.seq} sessionId={sessionId} event={e} />
      ))}
      {status === 'running' && (
        <div className="thinking-row">
          <span className="spinner" /> Claude is working…
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
