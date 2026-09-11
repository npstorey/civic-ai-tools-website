// The module that reads a data source's refusal off a `tools/call` response
// (#429; Wave N11 P3, rulings R1 and R6). The end-to-end drive — the real client,
// the real loop, a built package — is `is-error-is-a-rejected-call.test.ts`; this
// file holds the function every sender routes through to the flag's structure.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/mcp/tool-call-failure.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ERROR_RESULT_MESSAGE,
  McpErrorEnvelope,
  McpErrorResult,
  isSourceRefusal,
  throwIfErrorResult,
} from './tool-call-failure.ts';
import { classifyStreamError } from '../streaming.ts';

test('a result carrying isError: true throws McpErrorResult; any other result passes through', () => {
  assert.throws(() => throwIfErrorResult({ content: [{ type: 'text', text: 'no such table' }], isError: true }), McpErrorResult);
  for (const result of [
    { content: [{ type: 'text', text: '[]' }], isError: false },
    { content: [{ type: 'text', text: '[]' }] },
    // The flag is a boolean in the MCP specification; a string is not the flag.
    { isError: 'true' },
    null,
    undefined,
    'text',
  ]) {
    assert.doesNotThrow(() => throwIfErrorResult(result), `threw for ${JSON.stringify(result)}`);
  }
});

test('McpErrorResult is classified by its structure: generic, whatever words it is made to carry', () => {
  const error = new McpErrorResult();
  assert.equal(classifyStreamError(error), 'generic');
  // Even with every matcher and trigger word on it, the code is read first.
  error.message = 'the service is unavailable, the query timed out, the session ended with a 400, the filter did not parse';
  assert.equal(classifyStreamError(error), 'generic');
});

test('its fixed message carries none of the words the session retry, the parse rewrite or the classifier read', () => {
  const lower = ERROR_RESULT_MESSAGE.toLowerCase();
  for (const trigger of ['session', '400', 'parse']) {
    assert.ok(!lower.includes(trigger), `the fixed message carries "${trigger}"`);
  }
  // Read by its words alone — no code — it still classifies as nothing specific.
  assert.equal(classifyStreamError({ message: ERROR_RESULT_MESSAGE }), 'generic');
  assert.equal(new McpErrorResult().message, ERROR_RESULT_MESSAGE);
});

test('McpErrorEnvelope keeps the source’s message and carries no code, so the classifier and the retry read it as before', () => {
  const timedOut = new McpErrorEnvelope('The upstream query timed out before completing.');
  assert.equal(timedOut.message, 'The upstream query timed out before completing.');
  assert.equal('code' in timedOut, false);
  assert.equal(classifyStreamError(timedOut), 'mcp_timeout');
  assert.equal(new McpErrorEnvelope(undefined).message, '', 'an absent message stays absent, as `new Error(undefined)` has it');
});

test('isSourceRefusal: either shape the source answered with, and nothing that happened on this side', () => {
  assert.equal(isSourceRefusal(new McpErrorEnvelope('refused')), true);
  assert.equal(isSourceRefusal(new McpErrorResult()), true);
  for (const other of [new Error('refused'), { code: 'generic' }, { sourceRefusal: 'other' }, null, undefined, 'refused']) {
    assert.equal(isSourceRefusal(other), false, `read ${String(other)} as a source's refusal`);
  }
  // It reads the marker, not the class, so a second instance of the module agrees.
  assert.equal(isSourceRefusal({ sourceRefusal: 'error-result' }), true);
});
