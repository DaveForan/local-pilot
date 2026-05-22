import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import type { Request, Response, NextFunction } from 'express';
import { paths } from './config';

// A single shared access token gates the whole API. It is taken from
// LOCAL_PILOT_TOKEN if set, otherwise loaded from (or generated into)
// ~/.local-pilot/token. The token is the security boundary — without it the
// server would hand full Claude Code control to anyone who can reach the port.

let token = '';

export interface AuthInit {
  token: string;
  /** True when a fresh token was just generated (worth surfacing to the user). */
  generated: boolean;
  source: 'env' | 'file' | 'generated';
}

/** Load or create the access token. Call once at startup. */
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

/** Constant-time check of a presented token against the configured one. */
export function checkToken(presented: string | null | undefined): boolean {
  if (!presented || !token) return false;
  return timingSafeEqual(sha256(presented), sha256(token));
}

/** Express middleware: require a valid `Authorization: Bearer <token>`. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const match = /^Bearer\s+(.+)$/i.exec(req.header('authorization') ?? '');
  if (match && checkToken(match[1])) {
    next();
    return;
  }
  res.status(401).json({ error: 'unauthorized' });
}
