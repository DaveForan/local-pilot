import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { paths } from './config';

// MCP servers managed inside local-pilot. These are layered onto every
// Claude Code session the server starts (passed to the Agent SDK as
// `options.mcpServers`) — independent of the user's global ~/.claude config,
// so editing them here can never corrupt that file.

/** A locally-launched MCP server spoken to over stdio. */
export interface McpStdioServer {
  type?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/** A remote MCP server reached over HTTP or SSE. */
export interface McpRemoteServer {
  type: 'http' | 'sse';
  url: string;
  headers?: Record<string, string>;
}

export type McpServer = McpStdioServer | McpRemoteServer;
export type McpServers = Record<string, McpServer>;

export async function readMcpServers(): Promise<McpServers> {
  try {
    return JSON.parse(await fs.readFile(paths.mcp, 'utf8')) as McpServers;
  } catch {
    return {};
  }
}

export async function writeMcpServers(servers: McpServers): Promise<void> {
  await fs.writeFile(paths.mcp, JSON.stringify(servers, null, 2) + '\n', 'utf8');
}

/** Synchronous read — used when a session lazily spins up its runner. */
export function readMcpServersSync(): McpServers {
  try {
    return JSON.parse(readFileSync(paths.mcp, 'utf8')) as McpServers;
  } catch {
    return {};
  }
}
