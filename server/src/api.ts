import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import { listSnippets, addSnippet, deleteSnippet } from './snippets';
import { readSettings, writeSettings, listSkills } from './claudeConfig';
import { readMcpServers, writeMcpServers } from './mcpConfig';
import type { McpServers } from './mcpConfig';
import { readHooks, writeHooks, HOOK_EVENT_NAMES } from './hooks';
import type { HookConfig, HookEventName } from './hooks';
import { vapidPublicKey, addSubscription, removeSubscription } from './push';
import type { PushSubscriptionRecord } from './push';
import { transcribe, whisperReady } from './whisper';
import { synthesize, ttsReady, listVoices, setVoice } from './tts';
import type { SessionManager } from './sessionManager';
import { exportSessionMarkdown } from './sessionExport';

/** REST endpoints for everything that is not the live session stream. */
export function createApiRouter(manager: SessionManager) {
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

  // --- model catalog -------------------------------------------------------
  // The SDK reports this list over the control channel once a runner starts;
  // the manager caches the latest. Empty until at least one session has run.
  router.get('/models', (_req, res) => {
    res.json(manager.models());
  });

  // --- authenticated account info ------------------------------------------
  router.get('/account', (_req, res) => {
    res.json({ account: manager.account() });
  });

  // --- live MCP server status ----------------------------------------------
  // Returns null when no session has a live runner — MCP connections live
  // inside the SDK process, so there's nothing to query yet.
  router.get('/mcp/status', async (_req, res) => {
    res.json({ status: await manager.mcpServerStatus() });
  });

  // --- file rewind ---------------------------------------------------------
  // Body: { userUuid: string, dryRun?: boolean }. Returns a RewindResult.
  router.post('/sessions/:id/rewind', async (req, res) => {
    const session = manager.get(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'unknown session' });
      return;
    }
    const body = (req.body ?? {}) as { userUuid?: unknown; dryRun?: unknown };
    if (typeof body.userUuid !== 'string' || !body.userUuid) {
      res.status(400).json({ error: 'userUuid required' });
      return;
    }
    const dryRun = body.dryRun !== false;
    const result = await session.rewindFiles(body.userUuid, dryRun);
    res.json(result);
  });

  // --- session export ------------------------------------------------------
  router.get('/sessions/:id/export', (req, res) => {
    const session = manager.get(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'unknown session' });
      return;
    }
    const md = exportSessionMarkdown(session.meta, session.events);
    const safeName = (session.meta.title || 'session').replace(/[^a-z0-9._-]+/gi, '_');
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.md"`);
    res.send(md);
  });

  // --- text-to-speech (Piper) ----------------------------------------------
  router.get('/tts/status', (_req, res) => {
    res.json({ available: ttsReady() });
  });

  router.get('/tts/voices', async (_req, res) => {
    try {
      res.json(await listVoices());
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/tts/voice', async (req, res) => {
    const voice = typeof req.body?.voice === 'string' ? req.body.voice.trim() : '';
    if (!voice) {
      res.status(400).json({ error: 'voice is required' });
      return;
    }
    try {
      await setVoice(voice);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  router.post('/tts', async (req, res) => {
    if (!ttsReady()) {
      res.status(503).json({ error: 'Text-to-speech is not installed on the server' });
      return;
    }
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) {
      res.status(400).json({ error: 'text is required' });
      return;
    }
    try {
      const wav = await synthesize(text);
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Cache-Control', 'no-store');
      res.send(wav);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

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

  // --- user-defined hooks --------------------------------------------------
  router.get('/hooks', (_req, res) => {
    res.json({ events: HOOK_EVENT_NAMES, config: readHooks() });
  });
  router.put('/hooks', (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const clean: HookConfig = {};
      for (const name of HOOK_EVENT_NAMES) {
        const cmd = body[name];
        if (typeof cmd === 'string' && cmd.trim()) clean[name as HookEventName] = cmd;
      }
      writeHooks(clean);
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
