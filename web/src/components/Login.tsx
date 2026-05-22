import { useState } from 'react';
import { api } from '../api';
import { setToken } from '../auth';

/** Access-token sign-in screen, shown until a valid token is stored. */
export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [token, setTokenInput] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    const candidate = token.trim();
    if (!candidate || busy) return;
    setBusy(true);
    setErr(null);
    setToken(candidate);
    try {
      await api.auth();
      onSuccess();
    } catch {
      // req() clears the rejected token; just tell the user.
      setErr('That access token was not accepted.');
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
