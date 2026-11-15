// UX-2 P3b-2 (#729), criterion 6 (2F; Q2 = A, Q8 = A; C2 = A) and fix 11 (#729 6865424128): "About these settings"
// carries the harness sentence (H-1) and the "Why these models?" link, after the panel's lead and the keeping
// sentence, and the sentence renders nowhere else.
//
// THE RULE. H-1, byte for byte, once: "A harness is the data sources a question can use and the instructions the model
// gets for using them." (C2 = A, its second sentence cut). Then "Why these models?", moved verbatim from the form's
// Advanced-options region (`QueryForm.tsx:846-851` at b4766f1), linking `/learn#model-selection`, on the marketing
// origin when the instance sets one (fix 11: `/learn` is withheld on the app host). The sentence is one constant,
// `HARNESS_SENTENCE` in `src/components/composer/copy.ts`, referenced by the overlay alone (a source scan, as
// `panel-removed.test.ts` scans).
//
// WHAT IS DRIVEN. The real `SettingsOverlay` on its About sub-page, on the surface harness, with and without a
// marketing origin.
//
// WHAT MAKES IT ABLE TO FAIL. At P3b-2's base the About sub-page holds the lead, the keeping sentence and the privacy
// link only, and no file defines `HARNESS_SENTENCE`.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ComponentType, ReactElement } from 'react';
import { CONSENT_SURFACE_STUBS, SRC, h, installFetch, mount, registerSurfaceHooks, sessions, textOf, type HostElement } from '../sources/surface-test-harness.ts';

registerSurfaceHooks({ ...CONSENT_SURFACE_STUBS });
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';

const ORIGIN = 'https://site.fixture.example';
const target = { addEventListener() {}, removeEventListener() {} };
Object.assign(globalThis as Record<string, unknown>, {
  window: { ...target, location: { href: `${ORIGIN}/settings`, origin: ORIGIN, pathname: '/settings' }, scrollTo() {} },
  document: { ...target },
});

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const SettingsOverlay = (await load('components/settings/SettingsOverlay.tsx')).default as ComponentType<Record<string, unknown>>;
const { HostLinksProvider } = await load('components/HostLinksProvider.tsx');
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const { PANEL_LEAD } = await load('lib/sources/copy.ts');
const ROOT = path.resolve(SRC, '..');

const H1 = 'A harness is the data sources a question can use and the instructions the model gets for using them.';
const WHY = 'Why these models?';
const KEPT = 'Your consent is kept in a cookie until this browser session ends. The privacy page names the cookie.';

installFetch(ORIGIN, {
  '/api/flows': () => flowsRoute.GET(),
  '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
});

/** The About sub-page's paragraphs and links, in order: each <p>'s text, and each link as `link: words -> href`. */
async function about(wrap: (el: ReactElement) => ReactElement = (el) => el): Promise<string[]> {
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
  const s = await mount(wrap(h(SettingsOverlay, { mount: 'page', initialTab: 'about' })));
  await new Promise((resolve) => setTimeout(resolve, 50));
  await s.settle();
  const panels = s.elements().filter((el) => el.props.role === 'tabpanel');
  assert.equal(panels.length, 1, `premise: one sub-page shown, ${panels.length}`);
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { for (const c of node) walk(c); return; }
    if (node === null || typeof node !== 'object' || !('props' in (node as object))) return;
    const el = node as HostElement;
    if (el.type === 'p') out.push(textOf(el));
    if (el.type === 'a') out.push(`link: ${textOf(el)} -> ${String(el.props.href)}`);
    walk((el.props as { children?: unknown }).children);
  };
  walk(panels[0].props.children);
  s.unmount();
  return out;
}

test('P3b-2 criterion 6 (2F; Q2 = A, Q8 = A; C2 = A): About these settings reads the lead, the keeping sentence, then H-1 byte for byte and "Why these models?" linking /learn#model-selection', async () => {
  const read = await about();
  const lead = read.indexOf(PANEL_LEAD);
  const kept = read.indexOf(KEPT);
  assert.ok(lead !== -1 && kept > lead, `premise: the lead, then the keeping sentence: ${JSON.stringify(read)}`);
  assert.equal(read.filter((x) => x === H1).length, 1, `H-1 is not rendered once, byte for byte: ${JSON.stringify(read)}`);
  const why = read.findIndex((x) => x.startsWith(`link: ${WHY} -> `));
  assert.ok(read.indexOf(H1) > kept && why > read.indexOf(H1), `H-1 and the link are not after the lead and the keeping sentence, in that order: ${JSON.stringify(read)}`);
  assert.equal(read[why], `link: ${WHY} -> /learn#model-selection`, 'the link\'s address with no marketing origin');
});

test('P3b-2 fix 11: where the instance names a marketing origin, "Why these models?" links /learn#model-selection on it (the app host withholds /learn)', async () => {
  const read = await about((el) => h(HostLinksProvider, { value: { marketingOrigin: 'https://marketing.fixture.example', signInHref: 'https://app.fixture.example/ask' } }, el));
  assert.deepEqual(read.filter((x) => x.startsWith(`link: ${WHY}`)), [`link: ${WHY} -> https://marketing.fixture.example/learn#model-selection`]);
});

test('P3b-2 criterion 6 (Q2 = A): H-1 is one constant, HARNESS_SENTENCE in composer/copy.ts, and the overlay is the only component that renders it (a source scan)', () => {
  const tracked = execFileSync('git', ['ls-files', '--', 'src'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
  const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  assert.match(read('src/components/composer/copy.ts'), /export const HARNESS_SENTENCE\s*=\s*'A harness is the data sources a question can use and the instructions the model gets for using them\.'/, 'composer/copy.ts does not define HARNESS_SENTENCE as H-1');
  assert.deepEqual(tracked.filter((f) => f !== 'src/components/composer/copy.ts' && read(f).includes('HARNESS_SENTENCE')), ['src/components/settings/SettingsOverlay.tsx'], 'the components that reference HARNESS_SENTENCE');
  assert.deepEqual(tracked.filter((f) => f !== 'src/components/composer/copy.ts' && read(f).includes('the instructions the model gets for using them')), [], 'a component holds its own copy of H-1');
});
