// Tests for the friendly error-copy helpers added for demo dry-run hardening.
//
// These guard the load-bearing property: no raw error string, status code, or
// server name ever reaches the reader, while the model still gets honest
// (anti-hallucination) guidance when a data source fails.
//
// Run with: npm test   (or: node --test --experimental-strip-types src/lib/streaming.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyStreamError,
  friendlyStreamError,
  describeToolFailureForLlm,
  streamErrorPayload,
  STREAM_ERROR_KINDS,
} from './streaming.ts';

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

// --- Typed model-credential failures (#178) --------------------------------
//
// The server stamps `code` on SSE error events for the two credential
// failures. Classification must honor the code without parsing message text,
// and the copy must be operator-actionable (it names the env var — these
// errors only appear on self-hosted instances with a broken configuration).

test('classifyStreamError honors a typed code before any message parsing', () => {
  assert.equal(
    classifyStreamError({ code: 'model_not_configured', message: 'whatever' }),
    'model_not_configured',
  );
  assert.equal(
    classifyStreamError({ code: 'model_auth_rejected', message: 'whatever' }),
    'model_auth_rejected',
  );
  // An unknown code falls through to message classification.
  assert.equal(classifyStreamError({ code: 'bogus', message: 'rate limit exceeded' }), 'rate_limit');
});

test('classifyStreamError falls back to message shape for credential failures', () => {
  // The guard's own message (non-streaming route JSON path).
  assert.equal(
    classifyStreamError('No model API key is configured: OPENROUTER_API_KEY is missing or empty in the server environment.'),
    'model_not_configured',
  );
  // The SDK's constructor message (belt and braces).
  assert.equal(classifyStreamError('Missing credentials. Please pass an `apiKey`.'), 'model_not_configured');
  // A typical upstream 401 body message.
  assert.equal(classifyStreamError('401 Invalid API key provided'), 'model_auth_rejected');
});

test('friendlyStreamError gives distinct, operator-actionable copy for the two credential failures', () => {
  const notConfigured = friendlyStreamError({ code: 'model_not_configured' });
  const rejected = friendlyStreamError({ code: 'model_auth_rejected' });
  assert.notEqual(notConfigured, rejected);
  // Both name the env var so the operator knows exactly what to fix.
  assert.match(notConfigured, /OPENROUTER_API_KEY/);
  assert.match(rejected, /OPENROUTER_API_KEY/);
  // Distinguishing language: absent vs rejected.
  assert.match(notConfigured, /no AI model API key configured/i);
  assert.match(rejected, /rejected/i);
});

test('#258 C4: mcp_not_configured classifies from typed code and from message shape alike', () => {
  // Typed code (SSE error events, JSON error bodies from the guards).
  assert.equal(
    classifyStreamError({ code: 'mcp_not_configured', message: 'whatever' }),
    'mcp_not_configured',
  );
  // Message shape (paths that carry only a message — SSEError from a
  // pre-stream JSON refusal, a rethrown Error from the client backstop).
  assert.equal(
    classifyStreamError('No Socrata MCP endpoint is configured: SOCRATA_MCP_URL is missing or empty in the server environment.'),
    'mcp_not_configured',
  );
  // Beats the broader mcp_unavailable match even though the message says "MCP".
  assert.equal(
    classifyStreamError('The MCP server for tool "get_data" is not configured: SOCRATA_MCP_URL is missing or empty in the server environment. Set it and restart the server.'),
    'mcp_not_configured',
  );
});

test('#258 C4: friendlyStreamError names SOCRATA_MCP_URL and stays distinct from the availability kinds', () => {
  const copy = friendlyStreamError({ code: 'mcp_not_configured' });
  assert.match(copy, /SOCRATA_MCP_URL/, 'operator-actionable: names the variable');
  assert.match(copy, /no live data source configured/i);
  assert.notEqual(copy, friendlyStreamError(new Error('MCP initialization failed for "socrata": 503')));
  assert.notEqual(copy, friendlyStreamError(new Error('MCP tool "get_data" timed out after 45s')));
});

test('#258 C4: describeToolFailureForLlm handles the unconfigured kind without leaking configuration detail', () => {
  const text = describeToolFailureForLlm('get_data', { code: 'mcp_not_configured' });
  assert.match(text, /Do not estimate, guess, or fabricate/);
  assert.match(text, /no live data source configured/i);
  assert.ok(!text.includes('SOCRATA_MCP_URL'), 'env-var names never reach the model-relayed answer');
});

// --- #154: the wire carries a typed kind, never raw infrastructure text -----
//
// The defect: `friendlyStreamError` maps errors to calm copy at the RENDER
// site, so nothing raw was ever displayed — but the raw string (MCP server
// names, status codes, timeout text) still travelled in the SSE `error` event
// payload, readable in devtools. The fix classifies ONCE server-side and puts
// the friendly copy plus the classified kind on the wire.
//
// The naive version of that fix is a trap, and these tests exist to keep it
// shut. Sending the friendly copy with the OLD three-code branch would have
// made the render side re-run `classifyStreamError` on the copy itself:
// `mcp_not_configured`, `mcp_unavailable`, `connection` and `generic` survive
// that second pass only by lexical accident (their copy happens to contain a
// word a matcher looks for), and the other four — including the rate-limit
// copy that tells a reader to sign in and both operator-actionable model-key
// messages — would silently downgrade to "Something went wrong". So these
// assertions are pinned on the CODE path: a future copy edit cannot break
// them, because no assertion here depends on the wording of any message.

test('#154: every StreamErrorKind round-trips server -> wire -> render into its own bucket', () => {
  // Guard the "eight kinds" this phase enumerated: a ninth must be added to
  // STREAM_ERROR_KINDS deliberately, and the loop below then covers it.
  assert.equal(STREAM_ERROR_KINDS.length, 8, 'the eight classified kinds');

  for (const kind of STREAM_ERROR_KINDS) {
    // `streamErrorPayload` is the exact call the server chokepoint
    // (`reportStreamFailure`) makes, so this is the real wire shape.
    const payload = { type: 'error', panel: 'withMcp', ...streamErrorPayload(kind) };
    assert.equal(payload.code, kind, `wire carries the kind: ${kind}`);
    assert.equal(classifyStreamError(payload), kind, `round-trip: ${kind}`);
    assert.equal(friendlyStreamError(payload), payload.message, `render copy is stable: ${kind}`);
  }
});

test('#154: the round trip is decided by the carried code, not by the copy text', () => {
  // Pair each kind's code with a DIFFERENT kind's copy. If classification ever
  // fell back to reading the message for a payload that carries a kind, every
  // one of these would land in the wrong bucket.
  const kinds = [...STREAM_ERROR_KINDS];
  for (let i = 0; i < kinds.length; i++) {
    const kind = kinds[i];
    const contradictoryProse = streamErrorPayload(kinds[(i + 1) % kinds.length]).message;
    const payload = { type: 'error', message: contradictoryProse, code: kind };
    assert.equal(classifyStreamError(payload), kind, `code wins over prose: ${kind}`);
    assert.equal(
      friendlyStreamError(payload),
      streamErrorPayload(kind).message,
      `copy follows the code, not the message: ${kind}`,
    );
  }
});

test('#154: no sanitized payload carries raw infrastructure text', () => {
  // The env-var names in the three configuration-refusal messages are the
  // deliberate exception (#178, #258 C4): the reader of those messages is the
  // operator who can fix them, and their own tests above assert that naming as
  // a feature. Everything below is text only a raw error would contain.
  const RAW_ONLY = [
    '45s',
    '429',
    '502',
    '503',
    '504',
    'econnrefused',
    'enotfound',
    'fetch failed',
    'jsonrpc',
    'timed out',
    'timeout',
    'stack',
    'undefined',
  ];
  for (const kind of STREAM_ERROR_KINDS) {
    const { message } = streamErrorPayload(kind);
    assert.ok(message.length > 0, `non-empty copy: ${kind}`);
    const lower = message.toLowerCase();
    for (const fragment of RAW_ONLY) {
      assert.ok(!lower.includes(fragment), `copy for ${kind} leaks "${fragment}": ${message}`);
    }
  }
});

test('#154: rollout window — a client ignoring the code still renders calm copy', () => {
  // During a deploy, a browser running the previous bundle receives the new
  // payload and falls back to prose matching (its code branch knows only the
  // three configuration refusals). That fallback may land in a different
  // bucket — it is matching copy written for readers, not for matchers — but
  // it must always produce one of the calm strings, never raw text. This is
  // the defense-in-depth layer doing its remaining legitimate job.
  const CALM = new Set(STREAM_ERROR_KINDS.map((kind) => streamErrorPayload(kind).message));
  for (const kind of STREAM_ERROR_KINDS) {
    const staleClientView = friendlyStreamError(streamErrorPayload(kind).message);
    assert.ok(CALM.has(staleClientView), `stale-client copy for ${kind} is calm copy`);
  }
});
