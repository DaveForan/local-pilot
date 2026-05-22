// The access token, kept in localStorage. Sent on every API request and on
// the WebSocket URL. The server is the authority — these are just helpers.

const KEY = 'lp-token';

export function getToken(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(KEY, token);
  } catch {
    /* private mode — sign-in just won't persist */
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
