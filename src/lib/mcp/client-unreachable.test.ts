// Rider evidence for #178: unlike the model-credential path, a missing or
// unreachable MCP endpoint does NOT hang the request path. The MCP client
// fails loudly and bounded on its own — connection failures reject
// immediately, unresponsive servers hit the 45s AbortError timeout with a
// clear message, and `classifyStreamError` already maps both shapes to
// friendly copy. This test pins the connection-refused case.
//
// The registry captures env at module load, so the unreachable URL is set
// before `client.ts` is imported (node --test runs each file in its own
// process, so this cannot leak into other tests).
//
// Run with: npm test   (or: node --test --experimental-strip-types src/lib/mcp/client-unreachable.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Port 1 (tcpmux) on loopback: nothing listens there, so connections are
// refused immediately — a deterministic "unreachable endpoint" fixture.
process.env.SOCRATA_MCP_URL = 'http://127.0.0.1:1';

const { callMcpTool } = await import('./client.ts');
const { classifyStreamError } = await import('../streaming.ts');

test('callMcpTool against an unreachable MCP endpoint rejects promptly with a classifiable error', async () => {
  const t0 = Date.now();
  let caught: unknown;
  try {
    await callMcpTool('get_data', { type: 'catalog', query: 'test', portal: 'data.cityofnewyork.us' });
    assert.fail('expected callMcpTool to reject');
  } catch (error) {
    caught = error;
  }
  const elapsed = Date.now() - t0;

  // Bounded: connection refusal surfaces immediately, far inside the client's
  // own 45s worst-case AbortError timeout.
  assert.ok(elapsed < 5_000, `bounded time: took ${elapsed}ms`);
  assert.ok(caught instanceof Error);

  // The existing error-copy layer already classifies this shape as an MCP
  // availability failure — the request path surfaces it, it does not hang.
  assert.equal(classifyStreamError(caught), 'mcp_unavailable');
});
