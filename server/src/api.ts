import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import { listSnippets, addSnippet, deleteSnippet } from './snippets';
import { readSettings, writeSettings, listSkills } from './claudeConfig';

/** REST endpoints for everything that is not the live session stream. */
export function createApiRouter() {
  const router = express.Router();

  router.get('/health', (_req, res) => {
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
