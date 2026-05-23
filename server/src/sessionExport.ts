import type { SessionMeta, SessionEvent } from './protocol';

/** Format a session as plain Markdown for download / sharing. */
export function exportSessionMarkdown(meta: SessionMeta, events: SessionEvent[]): string {
  const lines: string[] = [];
  lines.push(`# ${meta.title}`);
  lines.push('');
  lines.push(`- Created: ${new Date(meta.createdAt).toISOString()}`);
  lines.push(`- Folder: \`${meta.cwd}\``);
  if (meta.model) lines.push(`- Model: \`${meta.model}\``);
  lines.push('');

  for (const e of events) {
    switch (e.kind) {
      case 'user':
        lines.push('## You');
        lines.push('');
        if (e.images?.length) lines.push(`_${e.images.length} image attachment(s)_`);
        if (e.text) lines.push(e.text);
        lines.push('');
        break;
      case 'assistant':
        lines.push('## Claude');
        lines.push('');
        lines.push(e.text);
        lines.push('');
        break;
      case 'thinking':
        lines.push('> _Thinking:_ ' + e.text.replace(/\n/g, ' '));
        lines.push('');
        break;
      case 'tool_use':
        lines.push(`### Tool: ${e.name}`);
        lines.push('```json');
        lines.push(JSON.stringify(e.input, null, 2));
        lines.push('```');
        lines.push('');
        break;
      case 'tool_result':
        lines.push(e.isError ? '### Tool error' : '### Tool result');
        if (e.content) {
          lines.push('```');
          lines.push(e.content);
          lines.push('```');
        }
        if (e.images?.length) lines.push(`_(${e.images.length} image(s) omitted)_`);
        lines.push('');
        break;
      case 'system':
        lines.push(`_${e.text}_`);
        lines.push('');
        break;
      case 'result':
        lines.push(
          `_Turn ${e.isError ? 'errored' : 'complete'}` +
            (e.durationMs != null ? ` · ${(e.durationMs / 1000).toFixed(1)}s` : '') +
            (e.costUsd != null ? ` · $${e.costUsd.toFixed(4)}` : '') +
            '_',
        );
        lines.push('');
        break;
      case 'permission':
        lines.push(
          `_Permission: ${e.toolName} — ${e.status}${e.resolution ? ' (' + e.resolution + ')' : ''}_`,
        );
        lines.push('');
        break;
    }
  }
  return lines.join('\n');
}
