import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { paths } from './config';

/** Read ~/.claude/settings.json (returns {} if absent or unreadable). */
export async function readSettings(): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await fs.readFile(paths.claudeSettings, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function writeSettings(settings: Record<string, unknown>): Promise<void> {
  await fs.mkdir(paths.claudeDir, { recursive: true });
  await fs.writeFile(paths.claudeSettings, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

export interface SkillInfo {
  name: string;
  description: string | null;
  path: string;
}

/** List user-scoped skills from ~/.claude/skills. */
export async function listSkills(): Promise<SkillInfo[]> {
  const skillsDir = path.join(paths.claudeDir, 'skills');
  if (!existsSync(skillsDir)) return [];
  const entries = await fs.readdir(skillsDir, { withFileTypes: true }).catch(() => []);
  const out: SkillInfo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(skillsDir, entry.name);
    let description: string | null = null;
    try {
      const md = await fs.readFile(path.join(dir, 'SKILL.md'), 'utf8');
      description = frontmatterField(md, 'description');
    } catch {
      // skill folder without a SKILL.md — still list it
    }
    out.push({ name: entry.name, description, path: dir });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function frontmatterField(md: string, field: string): string | null {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  if (!block) return null;
  const line = block[1].split('\n').find((l) => l.trimStart().startsWith(`${field}:`));
  if (!line) return null;
  return line.slice(line.indexOf(':') + 1).trim().replace(/^["']|["']$/g, '');
}
