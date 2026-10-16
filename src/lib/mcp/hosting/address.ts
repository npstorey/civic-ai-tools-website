// #617 P3 red commit: a hosted source's per-call address, not yet implemented.
import type { HostedMcpServer, McpServerConfig } from '../registry.ts';
import type { WakeOptions } from './lifecycle.ts';

export async function hostedServerForCall(
  _hosted: HostedMcpServer,
  _options: Omit<WakeOptions, 'secret'> = {},
): Promise<McpServerConfig> {
  throw new Error('hostedServerForCall: not implemented (#617 P3 red commit)');
}
