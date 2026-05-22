import type { SessionStatus } from '../protocol';

/** Visual treatment for each session status — used by the sidebar + chat header. */
export const STATUS: Record<SessionStatus, { label: string; color: string }> = {
  idle: { label: 'Idle', color: '#5b5b6e' },
  running: { label: 'Running', color: '#7c5cff' },
  awaiting_permission: { label: 'Needs you', color: '#ffb648' },
  error: { label: 'Error', color: '#ff5d7a' },
  ended: { label: 'Ended', color: '#3a3a47' },
};
