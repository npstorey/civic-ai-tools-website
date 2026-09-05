/**
 * A rejected call is not interchangeable with an answered one, and it discloses
 * no identifier the reader was never given (#402, #406).
 *
 * Wave N10's property, at the two surfaces that still treat a rejection as if it
 * had answered:
 *
 *   #402 — `canonicalizeToolCall` keys on the tool name and the canonical JSON
 *   of its arguments and nothing else. Two replay runs that asked the same
 *   question, one of them refused, therefore produce the SAME key, score a
 *   Jaccard overlap of 1, and are signed as `highly_reproducible` at "Tool
 *   overlap: 100%". D2 = B puts the failure in the key.
 *
 *   #406 — the executed generator's rejected-call cell interpolates
 *   `call.reason` verbatim. For `fetch`, `generateToolReason` returns
 *   `to look up <id>`, so the full record identifier — which embeds a portal
 *   AND a dataset id AND a row id — is rendered into a signed notebook cell,
 *   under a heading that has just said the step cannot be accounted for. The
 *   portal in that identifier is one the rejected call never reached.
 *
 *   The rule this violates is already written in this repository, thirty lines
 *   below the site that breaks it: `renderNotRerunnableStepCell`'s docstring
 *   says "The call's identifier is deliberately NOT rendered … printing it puts
 *   a source in front of a reader under a step the notebook has just said it
 *   cannot account for." One rule, two renderers, one of them blind to it.
 *
 * SCOPE, AND WHAT THIS FILE DOES NOT COVER. These are two pure functions driven
 * directly. It does not cover the record page's reproduction sentence (#416's
 * assertion half), which is rendered in JSX: `npm test` globs `src/**` + '/' + '*.test.ts'
 * only and this repository has no component-render tests at all (zero
 * `.test.tsx` files — a convention, not an oversight). An instrument for that
 * surface needs the sentence choice lifted into a pure function first, and the
 * phase that does so states its own red.
 *
 * FIXTURE SHAPES. Both assertions are driven on the shape that can fail:
 * #402's pair differs ONLY in `failed`, so a key that ignores it must collide;
 * #406's call is a `fetch` carrying a realistic `record:` identifier, because a
 * bare or absent id could not show the leak.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { canonicalizeToolCall } from './evidence/tool-call-identity.ts';
import { generateToolReason } from './streaming.ts';
import { renderFetchToolCell } from './notebook-author/tool-to-cell.ts';

const ARGS = {
  type: 'query',
  dataset_id: 'efgh-5678',
  portal: 'data.cityofnewyork.us',
  group: 'complaint_type',
} as const;

const RECORD_ID = 'record:data.cityofnewyork.us/erm2-nwe9/58273911';

test('#402: a rejected call and an answered call with the same arguments are different keys', () => {
  const answered = { name: 'get_data', args: { ...ARGS } };
  const rejected = { name: 'get_data', args: { ...ARGS }, failed: true, failureKind: 'unavailable' };

  assert.notEqual(
    canonicalizeToolCall(rejected as Parameters<typeof canonicalizeToolCall>[0]),
    canonicalizeToolCall(answered),
    'A call the source refused and a call that answered are being counted as the ' +
      'same tool call. Two replay runs that differ only in whether a request was ' +
      'refused then score a Jaccard overlap of 1, and the consistency attestation ' +
      'signs "highly_reproducible" over it. D2 = B: the failure belongs in the key, ' +
      'and the attestation states in its own text how it treats a rejected call.',
  );
});

test('#406: a rejected fetch discloses no record identifier in the notebook cell', () => {
  const call = {
    name: 'fetch',
    args: { id: RECORD_ID },
    reason: generateToolReason({ id: RECORD_ID }, 'fetch'),
    failed: true,
    failureKind: 'timeout',
  };

  const out = renderFetchToolCell(
    call as Parameters<typeof renderFetchToolCell>[0],
    { defaultPortal: null } as unknown as Parameters<typeof renderFetchToolCell>[1],
  );

  assert.notEqual(out, null, 'a failed fetch must still render a not-reproduced cell');
  const rendered = (out?.cells ?? [])
    .flatMap((cell) => (Array.isArray(cell.source) ? cell.source : [cell.source]))
    .join('');

  assert.doesNotMatch(
    rendered,
    /erm2-nwe9\/58273911|record:data\.cityofnewyork\.us/,
    'The rejected fetch cell renders the record identifier, which embeds a portal ' +
      'the call never reached, a dataset id and a row id — under a heading that has ' +
      'just said this step cannot be accounted for. It arrives through `call.reason`, ' +
      'which `generateToolReason` builds as `to look up <id>`. The rule is already ' +
      "written in `renderNotRerunnableStepCell`'s docstring; this renderer does not " +
      'honour it.\n\nRendered:\n' +
      rendered,
  );
});
