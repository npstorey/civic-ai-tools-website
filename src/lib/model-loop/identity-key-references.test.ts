// Guard: no file still describes the superseded four-field tool-call identity
// key (#380, Wave N9).
//
// WHAT CHANGED AND WHY. The replay identity key used to be a hand-picked
// field list — `name:type:dataset_id:portal` (equivalently written
// `name:args.type:args.dataset_id:args.portal` when read off the recorded
// `args` object) — computed inline in `AttestationDialog.tsx`. That list is
// the defect #363/#384 fixed: `search` and `fetch` carry none of those four
// fields, so every search collapsed to one key, and `where` was never in the
// list even for `get_data`. The key now lives in exactly one place,
// `canonicalizeToolCall` in `./tool-call-identity.ts` (see its header for the
// property and the two failure modes it replaces), and is the tool name plus
// a canonical JSON serialisation of the whole argument object.
//
// WHAT THIS GUARD READS. Three files measured at `c342fe0` still describe the
// old format:
//   - `replay-loop.ts:26`               — a header comment (also names the
//                                          key's old home, `AttestationDialog
//                                          .canonicalizeToolCall`)
//   - `run-tool-loop.test.ts:449`       — a comment
//   - `injection-and-bound.test.ts:614-620` — a comment PLUS a live
//                                          reconstruction of the old key,
//                                          asserted against a literal built
//                                          from the four fields
//
// This file reads all three as text (`fs.readFileSync`, no imports of the
// modules under test) and asserts none of them still writes the old format,
// and that the two comment-only files (replay-loop.ts, run-tool-loop.test.ts)
// point a reader at the one place the key actually lives.
//
// BLIND SPOT, STATED. This is a source-level guard: it sees text, not
// behaviour. It cannot tell a correct comment from a comment that merely
// avoids the two literal strings below, and it says nothing about whether
// `canonicalizeToolCall` itself computes the right key — that property is
// pinned in `./tool-call-identity.test.ts` (read it), which is the one file
// this guard treats as authoritative rather than as a text source.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FILES = {
  replayLoop: fileURLToPath(new URL('./replay-loop.ts', import.meta.url)),
  runToolLoopTest: fileURLToPath(new URL('./run-tool-loop.test.ts', import.meta.url)),
  injectionAndBoundTest: fileURLToPath(new URL('./injection-and-bound.test.ts', import.meta.url)),
};

const SOURCE = Object.fromEntries(
  Object.entries(FILES).map(([name, path]) => [name, readFileSync(path, 'utf8')]),
);

/** The old key, as it appears when read off the recorded `args` object. */
const OLD_FORMAT_ARGS_PREFIXED = 'name:args.type:args.dataset_id:args.portal';
/** The old key, as it appears in prose describing the field list itself. */
const OLD_FORMAT_BARE = 'name:type:dataset_id:portal';

/** A live reconstruction of the old key: the four fields, `.join(':')`ed. */
const JOIN_RECONSTRUCTION =
  /\[\s*record\.name\s*,\s*record\.args\.type\s*,\s*record\.args\.dataset_id\s*,\s*record\.args\.portal\s*\]\s*\.join\(\s*['"]:['"]\s*\)/;

test('#380: no file writes the old args-prefixed key format', () => {
  const hits = Object.entries(SOURCE)
    .filter(([, text]) => text.includes(OLD_FORMAT_ARGS_PREFIXED))
    .map(([name]) => name);
  assert.deepEqual(
    hits,
    [],
    `still contains "${OLD_FORMAT_ARGS_PREFIXED}": ${JSON.stringify(hits)} — ` +
      'the key is now computed by canonicalizeToolCall in ./tool-call-identity.ts',
  );
});

test('#380: no file writes the old bare four-field key format', () => {
  const hits = Object.entries(SOURCE)
    .filter(([, text]) => text.includes(OLD_FORMAT_BARE))
    .map(([name]) => name);
  assert.deepEqual(
    hits,
    [],
    `still contains "${OLD_FORMAT_BARE}": ${JSON.stringify(hits)} — ` +
      'the key is now computed by canonicalizeToolCall in ./tool-call-identity.ts',
  );
});

test('#380: no file reconstructs the old key by joining the four args fields', () => {
  const hits = Object.entries(SOURCE)
    .filter(([, text]) => JOIN_RECONSTRUCTION.test(text))
    .map(([name]) => name);
  assert.deepEqual(
    hits,
    [],
    `still reconstructs [name, args.type, args.dataset_id, args.portal].join(':'): ${JSON.stringify(hits)} — ` +
      'call canonicalizeToolCall(record) and check record.args.portal directly instead',
  );
});

test('#380: replay-loop.ts points at the one place the key lives', () => {
  assert.ok(
    SOURCE.replayLoop.includes('tool-call-identity'),
    'replay-loop.ts no longer mentions tool-call-identity — its header comment should point ' +
      'readers at ./tool-call-identity.ts, the single home of canonicalizeToolCall',
  );
});

test('#380: run-tool-loop.test.ts points at the one place the key lives', () => {
  assert.ok(
    SOURCE.runToolLoopTest.includes('tool-call-identity'),
    'run-tool-loop.test.ts no longer mentions tool-call-identity — its comment should point ' +
      'readers at ./tool-call-identity.ts, the single home of canonicalizeToolCall',
  );
});
