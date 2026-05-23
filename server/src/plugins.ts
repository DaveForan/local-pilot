import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { paths } from './config';

/** One plugin entry — matches the SDK's `SdkPluginConfig` for `type: 'local'`. */
export interface PluginEntry {
  type: 'local';
  path: string;
}

export function readPlugins(): PluginEntry[] {
  if (!existsSync(paths.plugins)) return [];
  try {
    const raw = JSON.parse(readFileSync(paths.plugins, 'utf-8'));
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((p) => p && typeof p === 'object' && typeof p.path === 'string' && p.path.trim())
      .map((p) => ({ type: 'local' as const, path: String(p.path).trim() }));
  } catch (err) {
    console.warn('[plugins] failed to read plugins.json:', err);
    return [];
  }
}

export function writePlugins(entries: PluginEntry[]): void {
  mkdirSync(path.dirname(paths.plugins), { recursive: true });
  const clean = entries
    .filter((p) => p && typeof p.path === 'string' && p.path.trim())
    .map((p) => ({ type: 'local' as const, path: p.path.trim() }));
  writeFileSync(paths.plugins, JSON.stringify(clean, null, 2));
}
