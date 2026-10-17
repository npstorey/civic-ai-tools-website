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
 * longer exists. `hosted-call-driven.test.ts` drives a resume whose address
 * differs, in the test "criterion 6: after a resume whose address differs,
 * the stale address is never reused".
 *
 * THE EXCHANGE RUNS HERE (R7 WF, G7 F1), handed in by the client, so that what
 * the call met decides what happens to the session: the idle window restarts
 * only once the call has met a live bridge, and a dead bridge is restarted
 * once and the exchange retried once (`WokenSource.checkBridge`). Bounded:
 * one restart and one retry per call, never more.
 */
import { McpConfigurationError, type HostedMcpServer, type McpServerConfig } from '../registry.ts';
import { HostedSourceUnavailableError, wakeHostedSource, type WakeOptions } from './lifecycle.ts';
import { readBridgeSecret, SOURCE_BRIDGE_SECRET_VARIABLE } from './token.ts';

/**
 * One call to a hosted source: wake it, run `exchange` against a config whose
 * address is the bridge's now and whose headers carry the bridge token, and
 * act on the outcome:
 *   - answered: restart the idle window, return the answer;
 *   - failed, and the bridge answers `/health`: the failure is the source's
 *     own; restart the idle window and rethrow it unchanged;
 *   - failed, and the bridge is restarted: retry the exchange once; its
 *     answer restarts the idle window, its failure is rethrown;
 *   - failed, and the bridge cannot be brought back: fail as the source being
 *     unavailable, with the idle window NOT restarted.
 */
export async function callHostedSource<T>(
  hosted: HostedMcpServer,
  exchange: (server: McpServerConfig) => Promise<T>,
  options: Omit<WakeOptions, 'secret'> = {},
): Promise<T> {
  const secret = readBridgeSecret();
  if (!secret) {
    throw new McpConfigurationError(
      `The hosted MCP server for "${hosted.sourceId}" is not configured: ${SOURCE_BRIDGE_SECRET_VARIABLE} is missing or empty in the server environment. Set it and restart the server.`,
    );
  }
  const woken = await wakeHostedSource(hosted, { ...options, secret });
  const server: McpServerConfig = {
    sourceId: hosted.sourceId,
    label: hosted.label,
    endpointUrl: woken.endpointUrl,
    headers: { Authorization: `Bearer ${woken.token}` },
    tools: hosted.tools,
    alias: hosted.alias,
    serverId: hosted.serverId,
  };
  let answer: T;
  try {
    answer = await exchange(server);
  } catch (error) {
    const bridge = await woken.checkBridge();
    if (bridge === 'dead') throw new HostedSourceUnavailableError(hosted.sourceId);
    if (bridge === 'alive') {
      await woken.keepAlive();
      throw error;
    }
    answer = await exchange(server);
  }
  await woken.keepAlive();
  return answer;
}
