// Tests for the friendly error-copy helpers added for demo dry-run hardening.
//
// These guard the load-bearing property: no raw error string, status code, or
// server name ever reaches the reader, while the model still gets honest
// (anti-hallucination) guidance when a data source fails.
//
// Run with: npm test   (or: node --test --experimental-strip-types src/lib/streaming.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyStreamError, friendlyStreamError, describeToolFailureForLlm } from './streaming.ts';

// The actual raw strings produced across the streaming/error path, paired with
// the kind each should classify to. Sources: mcp/client.ts, compare-stream
// route Promise.race, sse-client.ts.
const RAW_CASES: { raw: unknown; kind: ReturnType<typeof classifyStreamError> }[] = [
  { raw: 'MCP server "socrata" did not respond within 45s — the upstream server may be starting up or unresponsive. Please try again.', kind: 'mcp_timeout' },
  { raw: 'MCP tool call "get_data" timed out after 45s — the data source may be slow or unresponsive. Try a simpler query.', kind: 'mcp_timeout' },
  { raw: 'MCP tool "get_data" timed out after 45s', kind: 'mcp_timeout' },
  { raw: 'MCP initialization failed for "socrata": 502', kind: 'mcp_unavailable' },
  { raw: 'MCP server "socrata" error: 503 Service Unavailable', kind: 'mcp_unavailable' },
  { raw: 'No MCP server registered for tool "get_data"', kind: 'mcp_unavailable' },
  { raw: 'No response body', kind: 'connection' },
  { raw: 'Failed to connect to the server. Please try again.', kind: 'connection' },
  { raw: 'Connection lost before the query finished. Partial results may be shown.', kind: 'connection' },
  { raw: 'Rate limit exceeded', kind: 'rate_limit' },
  { raw: { status: 429, message: 'Rate limit exceeded' }, kind: 'rate_limit' }, // SSEError-like
  { raw: new Error('TypeError: something obscure'), kind: 'generic' },
  { raw: '', kind: 'generic' },
  { raw: null, kind: 'generic' },
  { raw: undefined, kind: 'generic' },
];

test('classifyStreamError maps each real raw string to the right kind', () => {
  for (const { raw, kind } of RAW_CASES) {
    assert.equal(classifyStreamError(raw), kind, `classify: ${JSON.stringify(raw)}`);
  }
});

test('an SSEError-like object with status 429 is rate_limit even with an unrelated message', () => {
  assert.equal(classifyStreamError({ status: 429, message: 'whatever' }), 'rate_limit');
});

// Fragments that must never appear in any reader-facing copy.
const FORBIDDEN_FRAGMENTS = ['45s', 'socrata', 'mcp', 'tool', '502', '503', '429', 'upstream', 'jsonrpc', 'fetch failed', 'econnrefused'];

test('friendlyStreamError never leaks raw fragments and returns non-empty calm copy', () => {
  for (const { raw } of RAW_CASES) {
    const copy = friendlyStreamError(raw);
    assert.ok(copy.length > 0, 'copy is non-empty');
    const lower = copy.toLowerCase();
    for (const frag of FORBIDDEN_FRAGMENTS) {
      assert.ok(!lower.includes(frag), `copy for ${JSON.stringify(raw)} leaks "${frag}": ${copy}`);
    }
  }
});

test('friendlyStreamError gives distinct copy for timeout vs unavailable vs rate limit', () => {
  const timeout = friendlyStreamError('MCP tool "get_data" timed out after 45s');
  const unavailable = friendlyStreamError('MCP server "socrata" error: 503 Service Unavailable');
  const rate = friendlyStreamError({ status: 429 });
  assert.match(timeout, /too long to respond/i);
  assert.match(unavailable, /temporarily unavailable/i);
  assert.match(rate, /request limit/i);
  // "data source" is user language (design-principles P9), not "MCP server".
  assert.match(timeout, /data source/i);
  assert.match(unavailable, /data source/i);
});

test('describeToolFailureForLlm keeps the anti-hallucination guard and bans raw leakage', () => {
  const rawTimeout = 'MCP tool call "get_data" timed out after 45s';
  const guidance = describeToolFailureForLlm('get_data', rawTimeout);
  // Anti-hallucination: the model must not invent values.
  assert.match(guidance, /do not estimate|fabricate|do not.*guess/i);
  // Must instruct the model not to echo raw infra detail into the answer.
  assert.match(guidance, /do not include any raw error text/i);
  // Timeout-specific guidance present.
  assert.match(guidance, /did not respond in time|timed out/i);
  // The guidance text itself must not contain the raw error string fragments.
  const lower = guidance.toLowerCase();
  for (const frag of ['45s', 'socrata', '502', '503']) {
    assert.ok(!lower.includes(frag), `LLM guidance leaks "${frag}"`);
  }
});

test('describeToolFailureForLlm distinguishes unavailable from generic', () => {
  const unavailable = describeToolFailureForLlm('get_data', 'MCP initialization failed for "socrata": 503');
  const generic = describeToolFailureForLlm('get_data', new Error('obscure non-mcp failure'));
  assert.match(unavailable, /temporarily unavailable/i);
  assert.match(generic, /could not be completed/i);
});
