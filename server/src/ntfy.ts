import { NTFY_URL, NTFY_TOPIC, PUBLIC_URL } from './config';

// Publish notifications to a self-hosted ntfy server. Disabled unless
// LOCAL_PILOT_NTFY_URL is configured. Uses ntfy's JSON publishing API so
// UTF-8 titles/bodies (emoji, non-ASCII) survive — the header-based API would
// mangle them, since HTTP headers are latin1-only.

export interface NtfyMessage {
  title: string;
  body: string;
  /** Session the notification refers to — used to build the click deep link. */
  sessionId: string;
}

// One ntfy server usually carries topics from several self-hosted services, so
// prefix the session title with the app name — an untagged notification named
// after a conversation is easy to mistake for another service's alert. The 🤖
// `robot_face` tag is the secondary signal.
const APP_LABEL = 'Local-Pilot';

function brandedTitle(title: string): string {
  const t = (title ?? '').trim();
  return t && t !== 'local-pilot' ? `${APP_LABEL}: ${t}` : APP_LABEL;
}

/** Fire-and-forget: never blocks the caller or throws into it. */
export function publishNtfy(msg: NtfyMessage): void {
  if (!NTFY_URL) return;
  const base = NTFY_URL.replace(/\/+$/, '');
  const payload: Record<string, unknown> = {
    topic: NTFY_TOPIC,
    title: brandedTitle(msg.title),
    message: msg.body,
    tags: ['robot_face'],
  };
  if (PUBLIC_URL) {
    payload.click = `${PUBLIC_URL.replace(/\/+$/, '')}/?session=${encodeURIComponent(msg.sessionId)}`;
  }
  void fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
    .then((r) => {
      if (!r.ok) console.error('[ntfy] publish failed:', r.status);
    })
    .catch((err) => console.error('[ntfy] publish error:', err));
}
