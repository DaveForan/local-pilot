/** Compact "time ago" string for session activity timestamps. */
export function relativeTime(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function clockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Truncate a long path from the left, keeping the meaningful tail. */
export function shortPath(p: string, max = 38): string {
  if (p.length <= max) return p;
  return '…' + p.slice(p.length - max + 1);
}
