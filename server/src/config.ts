import os from 'node:os';
import path from 'node:path';

export const PORT = Number(process.env.PORT ?? 8787);
export const HOST = process.env.HOST ?? '0.0.0.0';

const DATA_DIR = process.env.LOCAL_PILOT_DATA ?? path.join(os.homedir(), '.local-pilot');

export const paths = {
  data: DATA_DIR,
  sessions: path.join(DATA_DIR, 'sessions'),
  snippets: path.join(DATA_DIR, 'snippets.json'),
  // MCP servers local-pilot layers onto every session — kept in our own data
  // dir so we never have to rewrite the user's ~/.claude.json.
  mcp: path.join(DATA_DIR, 'mcp.json'),
  claudeDir: path.join(os.homedir(), '.claude'),
  claudeSettings: path.join(os.homedir(), '.claude', 'settings.json'),
  // The server runs from server/, so the built UI sits one level up.
  webDist: path.resolve(process.cwd(), '../web/dist'),
};

/** Default working directory offered when creating a session. */
export const DEFAULT_CWD =
  process.env.LOCAL_PILOT_DEFAULT_CWD ?? path.join(os.homedir(), 'Projects');
