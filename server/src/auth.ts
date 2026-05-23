import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import type { Request, Response, NextFunction } from 'express';
import { paths } from './config';

// --- the credential ---------------------------------------------------------
// A single static access token is the credential. Clients present it once at
// POST /api/login and receive an HttpOnly session cookie in return — the token
// itself is never stored in the browser. Source: LOCAL_PILOT_TOKEN, else
// ~/.local-pilot/token (generated on first run).

let token = '';

export interface AuthInit {
  token: string;
  generated: boolean;
  source: 'env' | 'file' | 'generated';
}

export function initAuth(): AuthInit {
  const fromEnv = process.env.LOCAL_PILOT_TOKEN?.trim();
  if (fromEnv) {
    token = fromEnv;
    return { token, generated: false, source: 'env' };
  }
  try {
    const saved = readFileSync(paths.token, 'utf8').trim();
    if (saved) {
      token = saved;
      return { token, generated: false, source: 'file' };
    }
  } catch {
    /* not created yet */
  }
  token = randomBytes(24).toString('base64url');
  writeFileSync(paths.token, token + '\n', { mode: 0o600 });
  return { token, generated: true, source: 'generated' };
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/** Constant-time check of a presented access token. */
function tokenMatches(presented: string): boolean {
  if (!presented || !token) return false;
  return timingSafeEqual(sha256(presented), sha256(token));
}

// --- sessions ---------------------------------------------------------------
// Granted at login and distinct from the credential. Held server-side so they
// can be revoked; in-memory, so a server restart signs everyone out.

const COOKIE_NAME = 'lp_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const sessions = new Map<string, number>(); // session id -> created-at ms

function createSession(): string {
  const id = randomBytes(32).toString('base64url');
  sessions.set(id, Date.now());
  return id;
}

function sessionValid(id: string | undefined): boolean {
  if (!id) return false;
  const created = sessions.get(id);
  if (created === undefined) return false;
  if (Date.now() - created > SESSION_TTL_MS) {
    sessions.delete(id);
    return false;
  }
  return true;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    if (key) out[key] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

/** True when a request or WebSocket handshake carries a valid session cookie. */
export function hasValidSession(cookieHeader: string | undefined): boolean {
  return sessionValid(parseCookies(cookieHeader)[COOKIE_NAME]);
}

// --- login rate limiting ----------------------------------------------------
// Throttles brute force against /api/login. Counts failures per client IP.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const failures = new Map<string, { count: number; since: number }>();

function rateLimited(ip: string): boolean {
  const rec = failures.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.since > WINDOW_MS) {
    failures.delete(ip);
    return false;
  }
  return rec.count >= MAX_FAILURES;
}

function recordFailure(ip: string): void {
  const now = Date.now();
  const rec = failures.get(ip);
  if (!rec || now - rec.since > WINDOW_MS) {
    failures.set(ip, { count: 1, since: now });
  } else {
    rec.count += 1;
  }
}

// --- express handlers + middleware ------------------------------------------

/** Require a valid session cookie. Applied to every /api route bar login. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (hasValidSession(req.headers.cookie)) {
    next();
    return;
  }
  res.status(401).json({ error: 'unauthorized' });
}

/** POST /api/login — exchange the access token for a session cookie. */
export function handleLogin(req: Request, res: Response): void {
  const ip = req.ip ?? 'unknown';
  if (rateLimited(ip)) {
    res.status(429).json({ error: 'Too many attempts — wait a few minutes.' });
    return;
  }
  const presented = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (!tokenMatches(presented)) {
    recordFailure(ip);
    res.status(401).json({ error: 'Invalid access token.' });
    return;
  }
  res.cookie(COOKIE_NAME, createSession(), {
    httpOnly: true,
    sameSite: 'strict',
    secure: req.secure, // set only over HTTPS (tailscale serve); fine on localhost
    path: '/',
    maxAge: SESSION_TTL_MS,
  });
  res.json({ ok: true });
}

/** POST /api/logout — destroy the session and clear the cookie. */
export function handleLogout(req: Request, res: Response): void {
  const id = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (id) sessions.delete(id);
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
}

/**
 * POST /api/auth/rotate-token — mint a new access token, persist it,
 * invalidate every issued cookie. The new token is returned ONCE in the
 * response body so the user can copy it for other devices. The current
 * caller's cookie is preserved so the UI doesn't kick them out.
 */
export function handleRotateToken(req: Request, res: Response): void {
  const next = randomBytes(24).toString('base64url');
  token = next;
  try {
    writeFileSync(paths.token, token + '\n', { mode: 0o600 });
  } catch (err) {
    res.status(500).json({ error: `Failed to persist token: ${String(err)}` });
    return;
  }
  // Invalidate every issued session cookie — *except* the caller's, so the
  // person who just rotated isn't logged out before they see the new token.
  const keep = parseCookies(req.headers.cookie)[COOKIE_NAME];
  for (const id of [...sessions.keys()]) {
    if (id !== keep) sessions.delete(id);
  }
  res.json({ ok: true, token });
}
