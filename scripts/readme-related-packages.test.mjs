// README.md's "Related" section names the @typedstandards packages this app
// consumes, at the version lines package.json allows (A8 of the 2026-10-10
// site-refresh inventory).
//
// The line named only verify-core for two months after the app also took
// produce-core and civic-typed-harness. Both directions fail here: a
// dependency the README does not name at its line, and a package the README
// names that package.json no longer carries. A bump in package.json therefore
// fails this test until the README line moves with it.
//
// The version line is read from the caret range: ^0.9.0 allows 0.9.x and
// ^1.2.0 allows 1.x. Any other range shape fails, so a new shape is decided
// here rather than guessed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SCOPE = '@typedstandards/';

function versionLine(range) {
  const m = /^\^(\d+)\.(\d+)\.\d+$/.exec(range);
  assert.ok(m, `unsupported range shape ${range}; teach versionLine() what it allows`);
  return m[1] === '0' ? `0.${m[2]}.x` : `${m[1]}.x`;
}

function relatedSection(readme) {
  const start = readme.indexOf('\n## Related\n');
  assert.ok(start >= 0, 'README.md has no "## Related" section');
  const end = readme.indexOf('\n## ', start + 1);
  return readme.slice(start, end < 0 ? undefined : end);
}

test('README Related names each consumed @typedstandards package at its version line, and no other', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const related = relatedSection(readFileSync(path.join(ROOT, 'README.md'), 'utf8'));

  const consumed = Object.entries(pkg.dependencies ?? {}).filter(([name]) => name.startsWith(SCOPE));
  assert.ok(consumed.length > 0, 'package.json has no @typedstandards dependency');
  for (const [name, range] of consumed) {
    const expected = `\`${name}\` ${versionLine(range)}`;
    assert.ok(related.includes(expected), `README Related should name ${expected}`);
  }

  const named = [...related.matchAll(/`(@typedstandards\/[a-z0-9-]+)`/g)].map((m) => m[1]);
  const consumedNames = new Set(consumed.map(([name]) => name));
  for (const name of named) {
    assert.ok(consumedNames.has(name), `README Related names ${name}, which package.json does not depend on`);
  }
});
