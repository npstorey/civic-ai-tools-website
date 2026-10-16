/**
 * A hosted source's address, for one call (#617 P3; seam c1).
 *
 * `callMcpTool` (`../client.ts`) routes a call, and when the server it routes
 * to is hosted it asks this module for the server to use for that call: a copy
 * of an addressed server config whose `endpointUrl` is the bridge's address as
 * the sandbox handle states it NOW (`domain(port)` plus `/mcp`) and whose
 * `headers` carry the bridge token. The client's exchange code then runs on
 * the copy exactly as it runs on any configured server.
 *
 * THE ADDRESS IS NEVER CONFIGURED AND NEVER KEPT. It is read from the handle
 * on every call. A resumed sandbox runs in a new session, which may answer at
 * a new address; a kept address would send the next call to a session that no
 * longer exists. `address.test.ts` drives a resume whose address differs.
 */
import { McpConfigurationError, type HostedMcpServer, type McpServerConfig } from '../registry.ts';
import { wakeHostedSource, type WakeOptions } from './lifecycle.ts';
import { readBridgeSecret, SOURCE_BRIDGE_SECRET_VARIABLE } from './token.ts';

/** The server config for one call to a hosted source. Wakes the source first. */
export async function hostedServerForCall(
  hosted: HostedMcpServer,
  options: Omit<WakeOptions, 'secret'> = {},
): Promise<McpServerConfig> {
  const secret = readBridgeSecret();
  if (!secret) {
    throw new McpConfigurationError(
      `The hosted MCP server for "${hosted.sourceId}" is not configured: ${SOURCE_BRIDGE_SECRET_VARIABLE} is missing or empty in the server environment. Set it and restart the server.`,
    );
  }
  const woken = await wakeHostedSource(hosted, { ...options, secret });
  return {
    sourceId: hosted.sourceId,
    label: hosted.label,
    endpointUrl: woken.endpointUrl,
    headers: { Authorization: `Bearer ${woken.token}` },
    tools: hosted.tools,
    alias: hosted.alias,
    serverId: hosted.serverId,
  };
}
