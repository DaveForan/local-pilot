import { useState } from 'react';
import { api } from '../api';

/** Access-token sign-in screen — exchanges the token for a session cookie. */
export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [token, setTokenInput] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    const candidate = token.trim();
    if (!candidate || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api.login(candidate);
      onSuccess();
    } catch (e) {
      const msg = (e as Error).message;
      setErr(msg === 'unauthorized' ? 'That access token was not accepted.' : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login-card">
        <div className="wordmark login-mark">
          <span className="dot-logo" />
          local<b>pilot</b>
        </div>
        <p className="login-hint">
          Enter the access token to continue. It is on the server in{' '}
          <code>~/.local-pilot/token</code>.
        </p>
        <input
          className="login-input"
          type="password"
          value={token}
          autoFocus
          placeholder="Access token"
          onChange={(e) => setTokenInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
        />
        {err && <div className="form-err">{err}</div>}
        <button
          className="btn btn-accent login-btn"
          onClick={() => void submit()}
          disabled={busy || token.trim() === ''}
        >
          {busy ? 'Checking…' : 'Sign in'}
        </button>
      </div>
    </div>
  );
}
