// UX-2 P6 + P10 (#729), criterion 25 (contract p6p10.md v5.2, 0d item 1; PQ4 (a), B = (i)): the cross-host session
// probe makes one request per URL however many callers read it.
//
// THE RULE. The Header and a directory row both read `useCrossHostSession` for the same app host. They share one
// in-flight request per URL: two callers on one URL make one request and both read its answer; a different URL makes
// its own. The hook's contract stands: no probe without a URL, none to the page's own origin, a failure reads false.
//
// WHAT IS DRIVEN. The real hook, in two components mounted side by side on the surface harness, every request answered
// and counted here.
//
// WHAT MAKES IT ABLE TO FAIL. Two callers on ONE URL (the shape the contract names): at the base each caller runs its
// own effect, so the app host is asked twice.
//
// BLIND SPOTS, stated. No browser: CORS, credentials and the 4-second timeout are not exercised. The Header's own tests
// (`src/components/header-nav.test.ts`) are its guard and run unchanged.
//
// Run with: npm test

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Fragment } from 'react';
import { CONSENT_SURFACE_STUBS, SRC, h, installFetch, mount, registerSurfaceHooks, type Surface } from '../components/sources/surface-test-harness.ts';

registerSurfaceHooks({ ...CONSENT_SURFACE_STUBS });

const MARKETING = 'https://marketing.fixture.example';
const target = { addEventListener() {}, removeEventListener() {} };
Object.assign(globalThis as Record<string, unknown>, {
  window: { ...target, location: { href: `${MARKETING}/directory`, origin: MARKETING, pathname: '/directory', search: '' }, setTimeout, clearTimeout },
});

const { useCrossHostSession } = (await import(pathToFileURL(path.join(SRC, 'hooks', 'useCrossHostSession.ts')).href)) as {
  useCrossHostSession: (statusUrl: string | null, enabled: boolean) => boolean;
};

function Reader({ url, label }: { url: string; label: string }) {
  const signedIn = useCrossHostSession(url, true);
  return h('span', { 'data-reader': label }, String(signedIn));
}

const mounted: Surface[] = [];
afterEach(() => {
  for (const s of mounted.splice(0)) s.unmount();
});

async function probe(urls: Array<[string, string]>, answer: Record<string, boolean>) {
  const installed = installFetch(MARKETING, {
    '/a/api/session-status': () => new Response(JSON.stringify({ signedIn: answer.a }), { status: 200 }),
    '/b/api/session-status': () => new Response(JSON.stringify({ signedIn: answer.b }), { status: 200 }),
  });
  const s = await mount(h(Fragment, null, ...urls.map(([label, url]) => h(Reader, { key: label, url, label }))));
  mounted.push(s);
  await new Promise((resolve) => setTimeout(resolve, 30));
  await s.settle();
  const read = Object.fromEntries(s.elements().filter((el) => el.props['data-reader']).map((el) => [String(el.props['data-reader']), String(el.props.children)]));
  return { read, requests: installed.sent.map((r) => r.path) };
}

test('criterion 25: two callers on one URL make one request, and both read its answer', async () => {
  const url = 'https://app-one.fixture.example/a/api/session-status';
  const { read, requests } = await probe([['header', url], ['row', url]], { a: true });
  assert.deepEqual(read, { header: 'true', row: 'true' });
  assert.deepEqual(requests, ['/a/api/session-status'], 'the app host was asked more than once');
});

test('criterion 25 (guard): two callers on two URLs make one request each', async () => {
  const { read, requests } = await probe(
    [['first', 'https://app-two.fixture.example/a/api/session-status'], ['second', 'https://app-two.fixture.example/b/api/session-status']],
    { a: true, b: false },
  );
  assert.deepEqual(read, { first: 'true', second: 'false' });
  assert.deepEqual(requests.sort(), ['/a/api/session-status', '/b/api/session-status']);
});
