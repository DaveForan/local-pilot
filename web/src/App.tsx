import { useState } from 'react';
import { usePilot, store } from './store';
import { Sidebar } from './components/Sidebar';
import { ChatPane } from './components/ChatPane';
import { NewSessionDialog } from './components/NewSessionDialog';
import { SettingsDialog } from './components/SettingsDialog';

export function App() {
  const { sessions, activeId, connected, error } = usePilot();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const active = sessions.find((s) => s.id === activeId) ?? null;

  return (
    <div className="app">
      <header className="topbar">
        <button
          className="icon-btn only-mobile"
          onClick={() => setDrawerOpen((v) => !v)}
          aria-label="Toggle sessions"
        >
          ☰
        </button>
        <div className="wordmark">
          <span className="dot-logo" />
          local<b>pilot</b>
        </div>
        <div className="spacer" />
        <div className={`conn ${connected ? 'on' : 'off'}`}>
          <span className="conn-dot" />
          {connected ? 'connected' : 'reconnecting…'}
        </div>
        <button
          className="icon-btn"
          onClick={() => setSettingsOpen(true)}
          aria-label="Open settings"
        >
          ⚙
        </button>
      </header>

      <div className="body">
        <Sidebar
          sessions={sessions}
          activeId={activeId}
          open={drawerOpen}
          onSelect={(id) => {
            store.select(id);
            setDrawerOpen(false);
          }}
          onNew={() => {
            setNewOpen(true);
            setDrawerOpen(false);
          }}
          onClose={() => setDrawerOpen(false)}
        />
        <main className="main">
          <ChatPane session={active} />
        </main>
      </div>

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
