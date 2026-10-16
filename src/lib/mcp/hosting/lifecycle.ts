// #617 P3 red commit: the hosted source's sandbox lifecycle, not yet
// implemented. Its constants and error class are the surface the tests read.
import type { HostedMcpServer } from '../registry.ts';

export const HOSTED_SANDBOX_NAME_PREFIX = 'civic-src-';
export const HOSTED_SOURCE_PORT = 8080;
export const DEFAULT_IDLE_WINDOW_MS = 10 * 60_000;
export const DEFAULT_WAKE_DEADLINE_MS = 30_000;

export class HostedSourceUnavailableError extends Error {
  readonly code = 'mcp_unavailable' as const;

  constructor(sourceId: string) {
    super(`The hosted MCP server "${sourceId}" is unavailable: its sandbox could not be reached.`);
    this.name = 'HostedSourceUnavailableError';
  }
}

export function hostingEnvironment(): string {
  return 'local';
}

export function hostedSandboxName(_alias: string, _version: string, _environment: string = hostingEnvironment()): string {
  throw new Error('hostedSandboxName: not implemented (#617 P3 red commit)');
}

export interface WakeOptions {
  secret: string;
  idleWindowMs?: number;
  deadlineMs?: number;
}

export interface WokenSource {
  endpointUrl: string;
  token: string;
  sandboxName: string;
  wake: 'created' | 'resumed' | 'running';
}

export async function wakeHostedSource(_source: HostedMcpServer, _options: WakeOptions): Promise<WokenSource> {
  throw new Error('wakeHostedSource: not implemented (#617 P3 red commit)');
}
