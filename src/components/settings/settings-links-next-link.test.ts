// UX-2 P4b, criterion 2 (the ORCH's brief, item 2b): every link that opens
// `/settings` is a `next/link`, never a plain `<a>`.
//
// WHY. The overlay keeps the `/settings` address by an intercepting route in the
// root `@modal` slot. Only a client-side navigation is intercepted: a plain
// `<a href="/settings">` is a full page load, which renders the real
// `/settings` page and unmounts the page beneath. On a question that is
// waiting at a pause, that drops the answer's stream. (Measured in leg A: the
// page beneath stays mounted across a soft open and Back.)
//
// WHAT IS READ. Every `.tsx` file `git ls-files` tracks under `src/` (tests
// excepted), parsed by the TypeScript compiler. A violation is a JSX `<a>`
// whose `href` names `/settings`: the literal, or an expression that mentions
// it or `SETTINGS_HREF`. The positive half names each surface that opens the
// overlay in P4b and requires a `<Link>` there whose `href` names it: the
// dashboard's Sources tab, the consent card, the pause's step card, the
// Sources panel, and the refusal's line (item 42, `NoSourcesOnLine`, which the three refusal surfaces
// mount: home, `/explore` and the review dialog's replay). The Header's
// "Settings" is a `Menu` item, and `Menu` renders its items as `Link`s
// (`src/components/ui/Menu.tsx`); `header-nav.test.ts` reads it.
//
// BLIND SPOTS, stated. A link built by `createElement('a', …)`, an `href` read
// from a variable whose name does not mention settings, and an untracked file
// are not seen. The existing `/privacy` links are plain `<a>` and stay so.
//
// WHAT MAKES IT ABLE TO FAIL. At the base no surface links `/settings`, so the
// positive half fails for each; the decoy below shows the negative half reads
// a plain `<a href="/settings">` as a violation.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT = path.resolve(SRC, '..');

const NAMES_SETTINGS = (text: string) => /['"`]\/settings(['"`?#/]|$)/.test(text) || /SETTINGS_HREF/.test(text);

interface Found { file: string; tag: string; href: string }

/** Every JSX opening element in `source` whose tag is `tags` and whose `href` names `/settings`. */
function linksTo(file: string, source: string, tags: readonly string[]): Found[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const out: Found[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf);
      if (tags.includes(tag)) {
        for (const attr of node.attributes.properties) {
          if (!ts.isJsxAttribute(attr) || attr.name.getText(sf) !== 'href' || attr.initializer === undefined) continue;
          const text = attr.initializer.getText(sf);
          if (NAMES_SETTINGS(text)) out.push({ file, tag, href: text });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const tracked = execFileSync('git', ['ls-files', '--', 'src'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter((f) => f.endsWith('.tsx') && !/\.test\.tsx?$/.test(f));

test('premise: the scan reads the tracked .tsx files under src/', () => {
  assert.ok(tracked.length > 50, `only ${tracked.length} tracked .tsx files were found`);
  assert.ok(tracked.includes('src/components/sources/SourcesPanel.tsx'), 'the scan does not see SourcesPanel.tsx');
});

test('decoy: a plain <a href="/settings"> reads as a violation, and a <Link> does not', () => {
  const decoy = 'export function X() { return <><a href="/settings">S</a><Link href="/settings">S</Link><a href={SETTINGS_HREF}>S</a><a href="/privacy">P</a></>; }';
  assert.deepEqual(linksTo('decoy.tsx', decoy, ['a']).map((f) => f.href), ['"/settings"', '{SETTINGS_HREF}']);
  assert.deepEqual(linksTo('decoy.tsx', decoy, ['Link']).map((f) => f.href), ['"/settings"']);
});

test('UX-2 P4b: no tracked component opens /settings with a plain <a>', () => {
  const plain = tracked.flatMap((file) => linksTo(file, fs.readFileSync(path.join(ROOT, file), 'utf8'), ['a']));
  assert.deepEqual(plain, [], `plain <a> links to /settings: ${JSON.stringify(plain)}`);
});

const SURFACES = [
  'src/components/dashboard/SourcesTab.tsx',
  'src/components/sources/ConsentCard.tsx',
  'src/components/answer-view/ConsentStep.tsx',
  'src/components/sources/SourcesPanel.tsx',
  // The refusal's link (item 42) lives in one component, which every refusal surface mounts (below).
  'src/components/sources/NoSourcesOnLine.tsx',
];

for (const file of SURFACES) {
  test(`UX-2 P4b: ${file} opens /settings with a next/link`, () => {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.ok(/from ['"]next\/link['"]/.test(source), `${file} does not import next/link`);
    assert.ok(linksTo(file, source, ['Link']).length >= 1, `${file} has no <Link> to /settings`);
  });
}

// UX-2 P3b-1: the home page's, /ask's and /explore's refusal slot moved from QueryForm.tsx and TraceControls.tsx into
// the composer they both mount, so the composer is the surface that renders it there.
for (const file of ['src/components/composer/Composer.tsx', 'src/components/evidence/AttestationDialog.tsx']) {
  test(`UX-2 P4b: ${file} renders the refusal through NoSourcesOnLine, whose link is a next/link`, () => {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.match(source, /<NoSourcesOnLine \/>/, `${file} does not render NoSourcesOnLine`);
  });
}
