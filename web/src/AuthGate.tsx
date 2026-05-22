import { useEffect, useState } from 'react';
import { App } from './App';
import { Login } from './components/Login';
import { api } from './api';

type Status = 'checking' | 'login' | 'ready';

/** Gates the app behind auth — checks the session cookie on load. */
export function AuthGate() {
  const [status, setStatus] = useState<Status>('checking');

  useEffect(() => {
    api
      .auth()
      .then(() => setStatus('ready'))
      .catch(() => setStatus('login'));
  }, []);

  if (status === 'checking') {
    return (
      <div className="login">
        <span className="spinner" />
      </div>
    );
  }
  if (status === 'login') return <Login onSuccess={() => setStatus('ready')} />;
  return <App />;
}
