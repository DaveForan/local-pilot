import os from 'node:os';
import path from 'node:path';

export const PORT = Number(process.env.PORT ?? 8787);
// Bind to loopback only: the app is reached over the tailnet exclusively via
// `tailscale serve`, never directly on the LAN. Override HOST at your own risk.
export const HOST = process.env.HOST ?? '127.0.0.1';

const DATA_DIR = process.env.LOCAL_PILOT_DATA ?? path.join(os.homedir(), '.local-pilot');

/** Whisper model used for server-side speech transcription. */
export const WHISPER_MODEL = process.env.LOCAL_PILOT_WHISPER_MODEL ?? 'base.en';

export const paths = {
  data: DATA_DIR,
  sessions: path.join(DATA_DIR, 'sessions'),
  snippets: path.join(DATA_DIR, 'snippets.json'),
  // MCP servers local-pilot layers onto every session — kept in our own data
  // dir so we never have to rewrite the user's ~/.claude.json.
  mcp: path.join(DATA_DIR, 'mcp.json'),
  // Web-push: generated VAPID keypair and the browser subscriptions.
  vapid: path.join(DATA_DIR, 'vapid.json'),
  pushSubs: path.join(DATA_DIR, 'push-subscriptions.json'),
  // Access token clients must present to use the API.
  token: path.join(DATA_DIR, 'token'),
  // Whisper: install-whisper.sh writes the resolved binary path to `binpath`.
  whisperBinPath: path.join(DATA_DIR, 'whisper', 'binpath'),
  whisperModel: path.join(DATA_DIR, 'whisper', 'models', `ggml-${WHISPER_MODEL}.bin`),
  // Piper TTS: install-piper.sh writes the binary + voice paths.
  piperBinPath: path.join(DATA_DIR, 'piper', 'binpath'),
  piperVoicePath: path.join(DATA_DIR, 'piper', 'voicepath'),
  claudeDir: path.join(os.homedir(), '.claude'),
  claudeSettings: path.join(os.homedir(), '.claude', 'settings.json'),
  // The server runs from server/, so the built UI sits one level up.
  webDist: path.resolve(process.cwd(), '../web/dist'),
};

/** Default working directory offered when creating a session. */
export const DEFAULT_CWD =
  process.env.LOCAL_PILOT_DEFAULT_CWD ?? path.join(os.homedir(), 'Projects');
