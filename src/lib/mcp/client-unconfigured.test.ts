// #258 C4: an instance with NO SOCRATA_MCP_URL refuses Socrata-routed tool
// calls with a typed error that names the variable — it never falls back to
// the reference deployment's host. The routes refuse up front via
// `getMissingMcpRoutingError()`; this pins the client-layer backstop behind
// them, and that the error-copy layer turns the refusal into the
// operator-actionable reader copy.
//
// The registry captures env at module load, so the variable is deleted
// before `client.ts` is imported (node --test runs each file in its own
// process, so this cannot leak into other tests — same idiom as
// client-unreachable.test.ts).
//
// Run with: npm test   (or: node --test --experimental-strip-types src/lib/mcp/client-unconfigured.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.SOCRATA_MCP_URL;

const { callMcpTool, routeTool } = await import('./client.ts');
const { McpConfigurationError } = await import('./registry.ts');
const { classifyStreamError, friendlyStreamError, describeToolFailureForLlm } = await import('../streaming.ts');

function catchFrom(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('expected the call to throw');
}

test('routeTool refuses an unconfigured Socrata tool with a typed error naming SOCRATA_MCP_URL', () => {
  const err = catchFrom(() => routeTool('get_data'));
  assert.ok(err instanceof McpConfigurationError);
  assert.equal(err.code, 'mcp_not_configured');
  assert.match(err.message, /SOCRATA_MCP_URL/);
  // A genuinely unknown tool keeps the generic message — no misattribution.
  const unknown = catchFrom(() => routeTool('no_such_tool'));
  assert.ok(unknown instanceof Error);
  assert.ok(!(unknown instanceof McpConfigurationError));
  assert.match(unknown.message, /No MCP server registered/);
});

test('callMcpTool rejects promptly and the error-copy layer renders the refusal', async () => {
  let caught: unknown;
  try {
    await callMcpTool('get_data', { type: 'catalog', query: 'test', portal: 'data.cityofnewyork.us' });
    assert.fail('expected callMcpTool to reject');
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof McpConfigurationError);

  // Reader-facing: friendlyStreamError maps it (via typed code AND message
  // shape) to operator-actionable copy naming the variable.
  assert.equal(classifyStreamError(caught), 'mcp_not_configured');
  assert.match(friendlyStreamError(caught), /SOCRATA_MCP_URL/);

  // LLM-facing: the tool-failure text preserves the anti-hallucination guard
  // and leaks no env-var or server detail into the model's answer.
  const llmText = describeToolFailureForLlm('get_data', caught);
  assert.match(llmText, /Do not estimate, guess, or fabricate/);
  assert.match(llmText, /no live data source configured/);
  assert.ok(!llmText.includes('SOCRATA_MCP_URL'), 'no raw configuration detail is fed to the model');
});
