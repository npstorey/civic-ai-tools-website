// UX-2 P6 + P10 (#729), criterion 13 (contract p6p10.md v5.2; Q4 = A, P10-1): the marketing pages' tab title and share
// cards carry the ruled name.
//
// THE RULE. With a brand: "<brand> - Reference implementation" as the title, `openGraph.title` and `twitter.title`. With
// no brand: "Typed Standards reference implementation" (P10-1's no-brand form, C1 = A).
//
// WHAT IS DRIVEN. `(marketing)/layout.tsx`'s exported metadata, read twice: once with `SITE_BRAND_NAME` set and once
// unset. The layout reads the brand when it loads, so each fixture imports its own copy (a query on the module's URL).
//
// WHAT MAKES IT ABLE TO FAIL. At the base all three read "<brand> - MCP Demo", and "MCP Demo" with no brand.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SRC, registerSurfaceHooks } from '../../components/sources/surface-test-harness.ts';

registerSurfaceHooks({});

const LAYOUT = pathToFileURL(path.join(SRC, 'app', '(marketing)', 'layout.tsx')).href;
interface Titles { title: unknown; openGraph?: { title?: unknown }; twitter?: { title?: unknown } }
async function titles(brand: string | null, tag: string): Promise<unknown[]> {
  if (brand === null) delete process.env.SITE_BRAND_NAME;
  else process.env.SITE_BRAND_NAME = brand;
  const { metadata } = (await import(`${LAYOUT}?${tag}`)) as { metadata: Titles };
  return [metadata.title, metadata.openGraph?.title, metadata.twitter?.title];
}

test('criterion 13 (P10-1): with a brand, the title and both share cards read "<brand> - Reference implementation"', async () => {
  assert.deepEqual(await titles('Fixture Brand', 'brand'), Array(3).fill('Fixture Brand - Reference implementation'));
});

test('criterion 13 (P10-1): with no brand, all three read "Typed Standards reference implementation"', async () => {
  assert.deepEqual(await titles(null, 'none'), Array(3).fill('Typed Standards reference implementation'));
});
