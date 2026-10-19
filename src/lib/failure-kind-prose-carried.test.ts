// R6 W2 (#632, ruling 4): the prose that predates `not_offered` and the
// replay's narrowing, carried from W1 as lines, and the stream's new kind.
//
// W1 added the `not_offered` failure kind (`TOOL_FAILURE_KINDS`) and narrowed
// replay to the record's offered set. Five passages still state the world
// before it, each a claim a reader or a producer acts on:
//   - `src/lib/evidence/packager.ts:144`, the publish input's `failureKind`;
//   - `src/lib/model-loop/run-tool-loop.ts` near `:1009`, "the four
//     `ToolFailureKind` values";
//   - `src/lib/mcp/tools.ts:24-31` and `:59`, that replay hands the model the
//     whole vocabulary;
//   - `docs/api/records-publish.md:152`, the `failureKind` row of the publish
//     contract;
//   - `docs/project-plan.md:234`, the compare route's failed-call record.
// Each enumerating passage must name every kind; each replay passage must not
// say replay keeps the full vocabulary. A passage that drifts from the
// vocabulary again fails here.
//
// And W2's one stream kind, `consent_required` (C3): a kind with its own
// reader copy, carried by its code, never re-derived from text.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOL_FAILURE_KINDS } from './notebook-author/tool-to-cell.ts';
import { classifyStreamError, friendlyStreamError, isStreamErrorKind } from './streaming.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const read = (relative: string) => fs.readFileSync(path.join(REPO, relative), 'utf8');

/** The passage starting at the first line containing `anchor`, `lines` long. */
function passage(relative: string, anchor: string, lines: number): string {
  const all = read(relative).split('\n');
  const at = all.findIndex((line) => line.includes(anchor));
  assert.notEqual(at, -1, `${relative}: no line contains ${JSON.stringify(anchor)}`);
  return all.slice(at, at + lines).join('\n');
}

const names = (text: string) => TOOL_FAILURE_KINDS.filter((kind) => !text.includes(kind));

test('ruling 4: the packager\'s failureKind comment names every failure kind', () => {
  assert.deepEqual(names(passage('src/lib/evidence/packager.ts', 'Why, when `failed` is true', 4)), []);
});

test('ruling 4: the loop\'s span comment does not count the failure kinds as four', () => {
  const text = passage('src/lib/model-loop/run-tool-loop.ts', '`error.kind` is the attribute name agreed', 8);
  assert.ok(!/the four `ToolFailureKind` values/.test(text), 'run-tool-loop.ts still says there are four ToolFailureKind values');
});

test('ruling 4: the publish contract\'s failureKind row names every failure kind', () => {
  const row = read('docs/api/records-publish.md').split('\n').find((line) => line.startsWith('| `failureKind`'));
  assert.ok(row, 'docs/api/records-publish.md has no failureKind row');
  assert.deepEqual(names(row!), []);
});

test('ruling 4: the project plan\'s failed-call sentence names every failure kind', () => {
  assert.deepEqual(names(passage('docs/project-plan.md', 'A call that **failed** carries', 3)), []);
});

test('ruling 4: tools.ts no longer says replay hands the model the whole vocabulary', () => {
  const text = read('src/lib/mcp/tools.ts');
  assert.ok(!text.includes('replay of a published record hands the model this list as is'), 'tools.ts:24-31 says replay offers every tool');
  assert.ok(!text.includes('replay does not, and keeps the full vocabulary'), 'tools.ts:59 says replay keeps the full vocabulary');
});

test('C3: consent_required is a stream kind with its own reader copy, read from its code', () => {
  assert.equal(isStreamErrorKind('consent_required'), true, 'consent_required is not a stream error kind');
  assert.equal(classifyStreamError({ code: 'consent_required', message: 'anything at all' }), 'consent_required');
  const copy = friendlyStreamError({ code: 'consent_required' });
  assert.notEqual(copy, friendlyStreamError({ code: 'generic' }), 'consent_required renders the generic copy');
  assert.match(copy, /nothing/i, 'the copy does not say nothing was sent');
});
