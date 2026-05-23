import http from 'node:http';
import path from 'node:path';
import { existsSync } from 'node:fs';
import express from 'express';
import { PORT, HOST, paths } from './config';
import { ensureDirs } from './store';
import { SessionManager } from './sessionManager';
import { WsHub } from './wsHub';
import { createApiRouter } from './api';
import { initPush } from './push';
import { initAuth, requireAuth, handleLogin, handleLogout } from './auth';
import { initWhisper } from './whisper';
import { initTts } from './tts';

async function main(): Promise<void> {
  await ensureDirs();
  await initPush();

  const auth = initAuth();
  if (auth.generated) {
    console.log('[auth] generated a new access token — sign in with it on each device:');
    console.log(`[auth]   ${auth.token}`);
    console.log(`[auth] (stored at ${paths.token})`);
  } else {
    console.log(`[auth] access token loaded from ${auth.source} — see ${paths.token}`);
  }

  console.log(
    initWhisper()
      ? '[whisper] speech transcription ready'
      : '[whisper] not installed — run `npm run whisper:install` for voice input',
  );
  console.log(
    initTts()
      ? '[piper] text-to-speech ready'
      : '[piper] not installed — run `npm run piper:install` for natural read-aloud',
  );

  const manager = new SessionManager();
  await manager.init();

  const app = express();
  // tailscale serve proxies from loopback — trust it so req.secure and
  // req.ip reflect the real client connection.
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '8mb' }));

  // Public — lets monitoring and the SPA shell load without a session.
  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  // Login is public (it issues the session); everything else is gated.
  app.post('/api/login', handleLogin);
  app.post('/api/logout', handleLogout);
  app.use('/api', requireAuth, createApiRouter(manager));

  // Serve the built UI in production; in dev the Vite server handles it.
  if (existsSync(paths.webDist)) {
    app.use(express.static(paths.webDist));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(paths.webDist, 'index.html'));
    });
    console.log(`[server] serving web UI from ${paths.webDist}`);
  } else {
    console.log('[server] web/dist not built — use the Vite dev server for the UI');
  }

  const server = http.createServer(app);
  const hub = new WsHub(server, manager);
  manager.setBroadcaster(hub);

  server.listen(PORT, HOST, () => {
    console.log(`[server] local-pilot listening on http://${HOST}:${PORT}`);
  });

  const shutdown = (): void => {
    console.log('\n[server] shutting down…');
    manager.disposeAll();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[server] fatal:', err);
  process.exit(1);
});
