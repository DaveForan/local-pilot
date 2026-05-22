import fs from 'node:fs/promises';
import { nanoid } from 'nanoid';
import { paths } from './config';

/** A saved prompt the user can fire into a session with one tap. */
export interface Snippet {
  id: string;
  title: string;
  body: string;
  createdAt: number;
}

async function readAll(): Promise<Snippet[]> {
  try {
    return JSON.parse(await fs.readFile(paths.snippets, 'utf8')) as Snippet[];
  } catch {
    return [];
  }
}

async function writeAll(list: Snippet[]): Promise<void> {
  await fs.writeFile(paths.snippets, JSON.stringify(list, null, 2), 'utf8');
}

export function listSnippets(): Promise<Snippet[]> {
  return readAll();
}

export async function addSnippet(title: string, body: string): Promise<Snippet> {
  const list = await readAll();
  const snippet: Snippet = { id: nanoid(8), title, body, createdAt: Date.now() };
  list.push(snippet);
  await writeAll(list);
  return snippet;
}

export async function deleteSnippet(id: string): Promise<void> {
  await writeAll((await readAll()).filter((s) => s.id !== id));
}
