import { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionEvent } from '../protocol';

interface Props {
  events: SessionEvent[];
  onClose: () => void;
}

/** Pull every searchable string out of one event. */
function searchableText(e: SessionEvent): string {
  switch (e.kind) {
    case 'user':
    case 'assistant':
    case 'thinking':
    case 'system':
      return e.text;
    case 'tool_use':
      try {
        return `${e.name} ${JSON.stringify(e.input)}`;
      } catch {
        return e.name;
      }
    case 'tool_result':
      return e.content;
    case 'permission':
      return `${e.toolName} ${e.resolution ?? ''}`;
    case 'result':
      return e.text;
    default:
      return '';
  }
}

/**
 * Find bar: opens on Ctrl-F (over the page, not the timeline). Walks the
 * events list for matches and scrolls each turn into view as the user pages
 * through them with prev/next. A turn carries a tagged anchor in Timeline
 * (data-turn-key) so we can find it by query selector.
 */
export function SearchBar({ events, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // For each event that matches, record the *turn key* (seq of the user
  // message that opens the turn it lives in).
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as { turnKey: number; eventSeq: number }[];
    let currentTurnKey = -1;
    const out: { turnKey: number; eventSeq: number }[] = [];
    for (const e of events) {
      if (e.kind === 'user') currentTurnKey = e.seq;
      const key = currentTurnKey >= 0 ? currentTurnKey : e.seq;
      if (searchableText(e).toLowerCase().includes(q)) {
        out.push({ turnKey: key, eventSeq: e.seq });
      }
    }
    return out;
  }, [events, query]);

  // Clamp the active index whenever the match list changes.
  useEffect(() => {
    if (activeIdx >= matches.length) setActiveIdx(0);
  }, [matches.length, activeIdx]);

  // Scroll to the active match. Turns expose data-turn-key in Timeline.
  useEffect(() => {
    if (matches.length === 0) return;
    const m = matches[activeIdx];
    const el = document.querySelector(
      `[data-turn-key="${m.turnKey}"]`,
    ) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('search-hit');
    const timer = window.setTimeout(() => el.classList.remove('search-hit'), 1400);
    return () => {
      window.clearTimeout(timer);
      el.classList.remove('search-hit');
    };
  }, [matches, activeIdx]);

  const total = matches.length;
  const step = (delta: number): void => {
    if (total === 0) return;
    setActiveIdx((i) => (i + delta + total) % total);
  };

  return (
    <div className="search-bar" role="search" aria-label="Find in session">
      <input
        ref={inputRef}
        className="search-input"
        type="search"
        placeholder="Find in session…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          } else if (e.key === 'Enter') {
            e.preventDefault();
            step(e.shiftKey ? -1 : 1);
          }
        }}
      />
      <span className="search-count">
        {query ? (total === 0 ? 'no matches' : `${activeIdx + 1} / ${total}`) : ''}
      </span>
      <button
        className="icon-btn search-nav"
        aria-label="Previous match"
        disabled={total === 0}
        onClick={() => step(-1)}
      >
        ↑
      </button>
      <button
        className="icon-btn search-nav"
        aria-label="Next match"
        disabled={total === 0}
        onClick={() => step(1)}
      >
        ↓
      </button>
      <button className="icon-btn" aria-label="Close find" onClick={onClose}>
        ✕
      </button>
    </div>
  );
}
