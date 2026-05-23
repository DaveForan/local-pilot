import { useEffect, useRef, useState } from 'react';
import type { SessionEvent } from './protocol';
import { usePilot, store } from './store';
import { Drawer } from './components/Drawer';
import { ChatPane } from './components/ChatPane';
import { NewSessionDialog } from './components/NewSessionDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { getTheme, applyTheme, type Theme } from './theme';

/** Recover the resolved model from a session's history (the SDK reports it
 *  in a "Session ready · model …" system line) for sessions that ran before
 *  the model was tracked on the session itself. */
const ACTIVE_KEY = 'lp-active-session';

function readSavedActive(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

function writeSavedActive(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* private mode — fine */
  }
}

function modelFromEvents(events: SessionEvent[] | undefined): string | null {
  if (!events) return null;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind === 'system') {
      const m = /model\s+(\S+)/.exec(e.text);
      if (m && m[1] !== 'default') return m[1];
    }
  }
  return null;
}

export function App() {
  const { sessions, activeId, events, connected, error } = usePilot();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(getTheme);
  const active = sessions.find((s) => s.id === activeId) ?? null;
  const activeModel =
    active?.model ?? (activeId ? modelFromEvents(events[activeId]) : null);

  // Has a session already been chosen this load? Prevents the restore effect
  // from overriding a push-notification deep-link or an explicit pick.
  const restoreTried = useRef(false);

  // Open the right session when arriving from a push notification: via a
  // `?session=` deep link on a cold start, or a service-worker message when
  // a window was already open.
  useEffect(() => {
    const deepLink = new URLSearchParams(location.search).get('session');
    if (deepLink) {
      restoreTried.current = true;
      store.select(deepLink);
    }
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (e: MessageEvent): void => {
      if (e.data?.type === 'open-session' && typeof e.data.sessionId === 'string') {
        restoreTried.current = true;
        store.select(e.data.sessionId);
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);

  // Once the sessions list arrives, reopen whichever session you were on last
  // — unless something already picked one (deep link, SW message, manual tap).
  useEffect(() => {
    if (restoreTried.current || sessions.length === 0) return;
    restoreTried.current = true;
    const saved = readSavedActive();
    if (saved && sessions.some((s) => s.id === saved)) {
      store.select(saved);
    } else if (saved) {
      writeSavedActive(null); // stale — that session is gone
    }
  }, [sessions]);

  // Remember the active session across reloads.
  useEffect(() => {
    writeSavedActive(activeId);
  }, [activeId]);

  const toggleTheme = (): void => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
  };

  return (
    <div className="app">
      <button
        className="floating-menu"
        onClick={() => setDrawerOpen(true)}
        aria-label="Open menu"
      >
        ☰
      </button>

      <main className="main">
        <ChatPane session={active} />
      </main>

      <Drawer
        open={drawerOpen}
        sessions={sessions}
        activeId={activeId}
        active={active}
        activeModel={activeModel}
        connected={connected}
        theme={theme}
        onSelect={(id) => {
          store.select(id);
          setDrawerOpen(false);
        }}
        onNew={() => {
          setNewOpen(true);
          setDrawerOpen(false);
        }}
        onOpenSettings={() => {
          setSettingsOpen(true);
          setDrawerOpen(false);
        }}
        onToggleTheme={toggleTheme}
        onClose={() => setDrawerOpen(false)}
      />

      {error && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button className="icon-btn" onClick={() => store.clearError()} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}

      {newOpen && <NewSessionDialog onClose={() => setNewOpen(false)} />}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
