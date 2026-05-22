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

async function main(): Promise<void> {
  await ensureDirs();
  await initPush();

  const manager = new SessionManager();
  await manager.init();

  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use('/api', createApiRouter());

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
