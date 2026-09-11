// THROWAWAY — Wave N11 (#434) P1 red instrument (D5 = A). Not for merge; the PR carrying it is closed unmerged.
//
// A publish that sends no `portal` must type-check: the field is deprecated and accepted on the wire,
// not required. At ea1164c the type check (`next build`'s, or `npm run typecheck`) must fail on the
// `return input;` below with TS2741: Property 'portal' is missing ... but required in type 'PackageInput'.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PackageInput } from './packager.ts';

export function publishWithoutPortal(input: Omit<PackageInput, 'portal'>): PackageInput {
  return input;
}

test('D5: PackageInput accepts a publish that sends no portal', () => {
  assert.equal(typeof publishWithoutPortal, 'function');
});
