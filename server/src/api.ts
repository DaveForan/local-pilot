import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import { listSnippets, addSnippet, deleteSnippet } from './snippets';
import { readSettings, writeSettings, listSkills } from './claudeConfig';
import { readMcpServers, writeMcpServers } from './mcpConfig';
import type { McpServers } from './mcpConfig';
import { vapidPublicKey, addSubscription, removeSubscription } from './push';
import type { PushSubscriptionRecord } from './push';
import { transcribe, whisperReady } from './whisper';

/** REST endpoints for everything that is not the live session stream. */
export function createApiRouter() {
  const router = express.Router();

  router.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Reached only when the auth middleware has already accepted the token —
  // the web client uses it to validate a token at sign-in.
  router.get('/auth', (_req, res) => {
    res.json({ ok: true });
  });

  // --- saved prompts --------------------------------------------------------
  router.get('/snippets', async (_req, res) => {
    res.json(await listSnippets());
  });

  router.post('/snippets', async (req, res) => {
    const { title, body } = req.body ?? {};
    if (!title || !body) {
      res.status(400).json({ error: 'title and body are required' });
      return;
    }
    res.json(await addSnippet(String(title), String(body)));
  });

  router.delete('/snippets/:id', async (req, res) => {
    await deleteSnippet(req.params.id);
    res.json({ ok: true });
  });

  // --- Claude Code configuration -------------------------------------------
  router.get('/claude/settings', async (_req, res) => {
    res.json(await readSettings());
  });

  router.put('/claude/settings', async (req, res) => {
    try {
      await writeSettings(req.body ?? {});
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/claude/skills', async (_req, res) => {
    res.json(await listSkills());
  });

  // --- speech transcription (whisper.cpp) ----------------------------------
  router.get('/transcribe/status', (_req, res) => {
    res.json({ available: whisperReady() });
  });

  router.post(
    '/transcribe',
    express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '25mb' }),
    async (req, res) => {
      if (!whisperReady()) {
        res.status(503).json({ error: 'Speech transcription is not installed on the server' });
        return;
      }
      const audio = req.body;
      if (!Buffer.isBuffer(audio) || audio.length === 0) {
        res.status(400).json({ error: 'No audio received' });
        return;
      }
      try {
        res.json({ text: await transcribe(audio) });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    },
  );

  // --- MCP servers (local-pilot's own layer) -------------------------------
  router.get('/mcp', async (_req, res) => {
    res.json(await readMcpServers());
  });

  router.put('/mcp', async (req, res) => {
    try {
      await writeMcpServers((req.body ?? {}) as McpServers);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // --- push notifications --------------------------------------------------
  router.get('/push/vapid', (_req, res) => {
    res.json({ publicKey: vapidPublicKey() });
  });

  router.post('/push/subscribe', async (req, res) => {
    try {
      await addSubscription(req.body as PushSubscriptionRecord);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  router.post('/push/unsubscribe', async (req, res) => {
    const endpoint = (req.body ?? {}).endpoint;
    if (typeof endpoint !== 'string') {
      res.status(400).json({ error: 'endpoint is required' });
      return;
    }
    await removeSubscription(endpoint);
    res.json({ ok: true });
  });

  // --- directory browser (for picking a session working directory) ---------
  router.get('/fs/list', async (req, res) => {
    const dir =
      typeof req.query.path === 'string' && req.query.path ? req.query.path : os.homedir();
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const dirs = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => ({ name: e.name, path: path.join(dir, e.name) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      res.json({ path: dir, parent: path.dirname(dir), dirs });
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  return router;
}
