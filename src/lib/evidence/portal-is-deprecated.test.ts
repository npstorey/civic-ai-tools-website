// The publish request's run-level `portal` is deprecated (#421; ruled D5 = A in
// Wave N11, #434 P1): optional in the type, accepted on the wire and ignored,
// and documented as deprecated with its date. Removal waits for the next major
// version of the publish contract, because external publishers send the field.
//
// THE TYPE-LEVEL HALF IS THE TYPE CHECKER. The two functions below are the
// assertions: `next build` and `npm run typecheck` both type-check test files,
// so this file fails the Build step, before any test runs, if either stops
// compiling.
//   - `publishInputWithoutPortal` compiles only while `portal` is optional on
//     `PackageInput`. Its red is run 34614080892 (draft PR #438, closed
//     unmerged): at `ea1164c` the same return failed with TS2741, "Property
//     'portal' is missing in type 'Omit<PackageInput, "portal">' but required
//     in type 'PackageInput'".
//   - `publishInputThatStillSendsPortal` compiles only while `portal` is still
//     a declared property. An object literal naming an undeclared property is
//     TS2353, so deleting the field before the next major fails here too.
// The runtime tests below then pin what a test CAN check at run time: the
// publish contract's own words, read from the table row and the two notes,
// and the dated `@deprecated` tag on the field.
//
// That the field reaches no byte is a different claim, driven in
// `run-level-portal-reaches-no-byte.test.ts`.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { PackageInput } from './packager.ts';

/** Compiles only while `PackageInput.portal` is optional. */
export function publishInputWithoutPortal(input: Omit<PackageInput, 'portal'>): PackageInput {
  return input;
}

/** Compiles only while `PackageInput.portal` is still declared. */
export function publishInputThatStillSendsPortal(input: Omit<PackageInput, 'portal'>): PackageInput {
  return { ...input, portal: 'data.still-accepted.example' };
}

const CONTRACT = readFileSync(new URL('../../../docs/api/records-publish.md', import.meta.url), 'utf8');
const DEPRECATED_ON = '2026-09-11';

/** The cells of one row of the contract's request-body table, by field name. */
function requestBodyRow(field: string): string[] {
  const section = CONTRACT.split('\n### Request body schema\n')[1]?.split('\n#### ')[0];
  assert.ok(section, 'the "Request body schema" section is not where this test reads it');
  const rows = section.split('\n').filter((line) => line.startsWith(`| \`${field}\``));
  assert.equal(rows.length, 1, `expected exactly one \`${field}\` row in the request-body table, found ${rows.length}`);
  return rows[0].split('|').slice(1, -1).map((cell) => cell.trim());
}

test('D5: the input without portal is the input, unchanged', () => {
  const input = { model: 'm' } as unknown as Omit<PackageInput, 'portal'>;
  assert.equal(publishInputWithoutPortal(input), input);
  assert.equal(publishInputThatStillSendsPortal(input).portal, 'data.still-accepted.example');
});

test('D5: the publish contract’s request table marks portal not required, and deprecated with its date', () => {
  const [name, type, required, description] = requestBodyRow('portal');
  assert.equal(name, '`portal`');
  assert.equal(type, 'string');
  assert.equal(required, 'no', 'the Required column of the portal row must read "no"');
  assert.ok(
    description.startsWith(`**Deprecated (${DEPRECATED_ON}).**`),
    `the portal row's description must open with the dated deprecation, not: ${description.slice(0, 80)}…`,
  );
  assert.doesNotMatch(description, /keep sending it/, 'a deprecated field is not one to keep sending');
});

test('D5: the portal note and the known-assumptions entry agree with the row, and the change log is dated', () => {
  const lines = CONTRACT.split('\n');
  const note = lines.filter((line) => line.startsWith('- **`portal`** —'));
  assert.equal(note.length, 1, 'expected one `portal` note under "Notes on specific fields"');
  assert.match(note[0], new RegExp(`Deprecated as of ${DEPRECATED_ON}`));

  const assumption = lines.filter((line) => /^\d+\. \*\*`portal`/.test(line));
  assert.equal(assumption.length, 1, 'expected one `portal` entry under "Known chat-flow assumptions"');
  assert.match(assumption[0], /deprecated/);
  assert.doesNotMatch(assumption[0], /is required/, 'the known assumption still calls portal required');

  assert.equal(
    lines.filter((line) => line.startsWith(`- **${DEPRECATED_ON}** — **\`portal\` deprecated`)).length,
    1,
    'expected one dated change-log entry for the deprecation',
  );
});

test('D5: PackageInput.portal carries a dated @deprecated tag', () => {
  const source = readFileSync(new URL('./packager.ts', import.meta.url), 'utf8');
  const docblock = /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*portal\?: string;/.exec(source);
  assert.ok(docblock, 'PackageInput has no optional `portal` field with a docblock above it');
  assert.match(docblock[1], new RegExp(`@deprecated ${DEPRECATED_ON}`));
});
