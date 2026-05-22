import { useEffect, useState } from 'react';
import { App } from './App';
import { Login } from './components/Login';
import { getToken } from './auth';
import { api } from './api';

type Status = 'checking' | 'login' | 'ready';

/** Gates the app behind the access token — validates a stored token on load. */
export function AuthGate() {
  const [status, setStatus] = useState<Status>('checking');

  useEffect(() => {
    if (!getToken()) {
      setStatus('login');
      return;
    }
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
