import { useEffect, useState } from 'react';
import { usePilot, store } from './store';
import { Drawer } from './components/Drawer';
import { ChatPane } from './components/ChatPane';
import { NewSessionDialog } from './components/NewSessionDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { getTheme, applyTheme, type Theme } from './theme';

export function App() {
  const { sessions, activeId, connected, error } = usePilot();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(getTheme);
  const active = sessions.find((s) => s.id === activeId) ?? null;

  // Open the right session when arriving from a push notification: via a
  // `?session=` deep link on a cold start, or a service-worker message when
  // a window was already open.
  useEffect(() => {
    const deepLink = new URLSearchParams(location.search).get('session');
    if (deepLink) store.select(deepLink);
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (e: MessageEvent): void => {
      if (e.data?.type === 'open-session' && typeof e.data.sessionId === 'string') {
        store.select(e.data.sessionId);
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);

  const toggleTheme = (): void => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
  };

  return (
    <div className="app">
      <header className="topbar">
        <button className="icon-btn" onClick={() => setDrawerOpen(true)} aria-label="Open menu">
          ☰
        </button>
        <div className="topbar-title">{active ? active.title : 'local·pilot'}</div>
      </header>

      <main className="main">
        <ChatPane session={active} />
      </main>

      <Drawer
        open={drawerOpen}
        sessions={sessions}
        activeId={activeId}
        active={active}
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
