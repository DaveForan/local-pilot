import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { paths } from './config';

/** SDK hook event names — kept loose so we don't have to import SDK types. */
export const HOOK_EVENT_NAMES = [
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'SessionStart',
  'SessionEnd',
  'Stop',
  'PreCompact',
  'Notification',
] as const;
export type HookEventName = (typeof HOOK_EVENT_NAMES)[number];

/** Persisted shape: per-event shell command (empty / missing = no hook). */
export type HookConfig = Partial<Record<HookEventName, string>>;

/** Max wall-clock time a single hook may take before we give up on it. */
const HOOK_TIMEOUT_MS = 30_000;

export function readHooks(): HookConfig {
  if (!existsSync(paths.hooks)) return {};
  try {
    const raw = JSON.parse(readFileSync(paths.hooks, 'utf-8')) as Record<string, unknown>;
    const out: HookConfig = {};
    for (const name of HOOK_EVENT_NAMES) {
      const cmd = raw[name];
      if (typeof cmd === 'string' && cmd.trim()) out[name] = cmd;
    }
    return out;
  } catch (err) {
    console.warn('[hooks] failed to read hooks.json:', err);
    return {};
  }
}

export function writeHooks(config: HookConfig): void {
  mkdirSync(path.dirname(paths.hooks), { recursive: true });
  const clean: HookConfig = {};
  for (const name of HOOK_EVENT_NAMES) {
    const cmd = config[name];
    if (typeof cmd === 'string' && cmd.trim()) clean[name] = cmd.trim();
  }
  writeFileSync(paths.hooks, JSON.stringify(clean, null, 2));
}

/**
 * Wrap one user shell command as an SDK HookCallback. The hook receives the
 * full HookInput on stdin as JSON; whatever the command prints to stdout, if
 * it parses as JSON, becomes the HookJSONOutput. Failures are swallowed so
 * a broken hook never breaks the session.
 */
export function buildHookCallback(command: string): (
  input: unknown,
) => Promise<Record<string, unknown>> {
  return (input) =>
    new Promise((resolve) => {
      let settled = false;
      const done = (result: Record<string, unknown>): void => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      let child;
      try {
        child = spawn('sh', ['-c', command], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, LOCAL_PILOT_HOOK: '1' },
        });
      } catch (err) {
        console.warn('[hooks] spawn failed:', err);
        done({});
        return;
      }

      const stdoutChunks: Buffer[] = [];
      child.stdout?.on('data', (b: Buffer) => stdoutChunks.push(b));
      child.stderr?.on('data', (b: Buffer) => {
        // Surface hook stderr so the user can debug — but never let it
        // break the session.
        process.stderr.write(`[hook] ${b.toString()}`);
      });

      const timer = setTimeout(() => {
        try {
          child.kill('SIGTERM');
        } catch {
          /* ignore */
        }
        done({});
      }, HOOK_TIMEOUT_MS);

      child.on('error', (err) => {
        clearTimeout(timer);
        console.warn('[hooks] runtime error:', err);
        done({});
      });
      child.on('close', () => {
        clearTimeout(timer);
        const text = Buffer.concat(stdoutChunks).toString().trim();
        if (!text) return done({});
        try {
          const parsed = JSON.parse(text);
          done(typeof parsed === 'object' && parsed ? (parsed as Record<string, unknown>) : {});
        } catch {
          // Non-JSON output is fine — it just means the hook had no
          // structured response; treat it as a no-op.
          done({});
        }
      });

      try {
        child.stdin?.end(JSON.stringify(input));
      } catch {
        /* the child may have already exited */
      }
    });
}

/** Build the `hooks` option the SDK expects, given our flat config map. */
export function buildSdkHookOptions(config: HookConfig): Record<string, unknown> | null {
  const events = Object.entries(config).filter(([, cmd]) => cmd && cmd.trim());
  if (events.length === 0) return null;
  const out: Record<string, unknown> = {};
  for (const [event, cmd] of events) {
    out[event] = [{ hooks: [buildHookCallback(cmd as string)] }];
  }
  return out;
}
