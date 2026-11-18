// UX-2-FIX P3 (#790), D13 = A: the three "no limits" lines replaced (contract p3.md section 2, 13.1 to 13.3).
//
// THE RULE. Each line that pointed a reader at running the tools locally "with no limits" points at `/project`'s setup
// section, `{marketingOrigin}/project#run-it-yourself`, in the ruled words:
//   13.1, the "may be incomplete" notice (`McpResponseDisplay`): "Analysis may be incomplete. This site has token and
//         tool-call limits that can cut short complex queries. To work without this site's limits, see [Run it
//         yourself] on the project page." On an instance that serves no marketing pages (`marketingOrigin` null) the
//         third sentence is not rendered.
//   13.2, the token-limit banner's link (`McpResponseDisplay`): "[Run it yourself]".
//   13.3, `/explore`'s two-minute line's link (`LiveResponsePanel`): "[Run it yourself]", still opening a new tab (the
//         line above it says "Don't close this tab").
//
// WHAT IS DRIVEN. The real `McpResponseDisplay` and `LiveResponsePanel` inside `HostLinksProvider`, on the surface
// harness, with the marketing origin `''` (a single host), a host (a split topology), and `null` (no marketing pages).
// The two-minute line is reached by moving `Date.now` past its 120 s threshold while the panel runs.
//
// WHAT MAKES IT ABLE TO FAIL. At the base 13.1 reads "For the full analysis with no limits, run locally with Claude
// Code or Cursor." (a link to the hub's repository) on every origin, null included; 13.2 reads "Try this locally (no
// limits)" to `/learn#try-it`; 13.3 reads "Run locally (no limits)" to the hub's repository on every origin.
//
// BLIND SPOTS, stated. No layout or colour: the notices' colours are not ruled here and are not read.
//
// Run with: npm test

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ComponentType } from 'react';
import { CONSENT_SURFACE_STUBS, SRC, h, mount, registerSurfaceHooks, sessions, textOf, type HostElement, type Surface } from '../sources/surface-test-harness.ts';

registerSurfaceHooks({ ...CONSENT_SURFACE_STUBS });
sessions.server = null;
sessions.client = { status: 'unauthenticated', data: null };

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const McpResponseDisplay = (await load('components/shared/McpResponseDisplay.tsx')).default as ComponentType<Record<string, unknown>>;
const LiveResponsePanel = (await load('components/explore/LiveResponsePanel.tsx')).default as ComponentType<Record<string, unknown>>;
const { HostLinksProvider } = await load('components/HostLinksProvider.tsx');

const MARKETING = 'https://marketing.fixture.example';
const ORIGINS: Array<string | null> = ['', MARKETING, null];
const TARGET = '/project#run-it-yourself';
const LIMITS = 'Analysis may be incomplete. This site has token and tool-call limits that can cut short complex queries.';
const NOTICE_131 = `${LIMITS} To work without this site's limits, see Run it yourself on the project page.`;

const mounted: Surface[] = [];
const realNow = Date.now;
afterEach(() => {
  Date.now = realNow;
  for (const s of mounted.splice(0)) s.unmount();
});

async function within(marketingOrigin: string | null, child: ReturnType<typeof h>): Promise<Surface> {
  const s = await mount(h(HostLinksProvider, { value: { marketingOrigin, signInHref: null } }, child));
  mounted.push(s);
  await s.settle();
  return s;
}

const linksReading = (s: Surface, words: string): HostElement[] => s.elements().filter((el) => el.type === 'a' && textOf(el) === words);
/** The smallest element whose text starts with `start`: the notice itself, not a container around it. */
function smallestStartingWith(s: Surface, start: string): HostElement | undefined {
  const holding = s.elements().filter((el) => textOf(el).startsWith(start));
  return holding[holding.length - 1];
}

// An answer the heuristic reads as cut short (`detectIncompleteResponse`), with no token-limit flag.
const INCOMPLETE = 'The fixture analysis found three relevant datasets, but I couldn\'t complete the comparison of all of them.';

for (const origin of ORIGINS) {
  const where = origin === null ? 'null (no marketing pages)' : origin === '' ? "'' (a single host)" : 'a marketing host';
  test(`UX-2-FIX P3 D13 13.1, marketing origin ${where}: the "may be incomplete" notice reads its ruled words`, async () => {
    const s = await within(origin, h(McpResponseDisplay, { content: INCOMPLETE, isComplete: true, token_limit_exceeded: false }));
    const notice = smallestStartingWith(s, 'Analysis may be incomplete.');
    assert.ok(notice, `premise: the notice renders; the panel reads: ${s.text().slice(0, 300)}`);
    if (origin === null) {
      assert.equal(textOf(notice!), LIMITS, 'with no marketing pages, only the first two sentences');
      assert.equal(linksReading(s, 'Run it yourself').length, 0, 'a "Run it yourself" link with no marketing pages');
    } else {
      assert.equal(textOf(notice!), NOTICE_131);
      assert.deepEqual(linksReading(s, 'Run it yourself').map((a) => a.props.href), [`${origin}${TARGET}`]);
    }
    assert.ok(!/no limits/i.test(s.text()), 'the panel still says "no limits"');
  });

  test(`UX-2-FIX P3 D13 13.2, marketing origin ${where}: the token-limit banner's link reads "Run it yourself", to the setup section`, async () => {
    const s = await within(origin, h(McpResponseDisplay, { content: 'A fixture answer cut short.', isComplete: true, token_limit_exceeded: true }));
    assert.ok(s.text().includes('This response was cut short due to token limits.'), 'premise: the banner renders');
    assert.deepEqual(linksReading(s, 'Run it yourself').map((a) => a.props.href), origin === null ? [] : [`${origin}${TARGET}`]);
    assert.ok(!/no limits/i.test(s.text()), 'the banner still says "no limits"');
  });

  test(`UX-2-FIX P3 D13 13.3, marketing origin ${where}: /explore's two-minute line links "Run it yourself" to the setup section, in a new tab`, async () => {
    const s = await within(origin, h(LiveResponsePanel, {
      content: '', elapsedMs: 0, iterationCount: 0, isComplete: false, isRunning: true, progressLog: [], progressGroups: [], toolsCalled: [], queryText: 'q',
    }));
    const start = realNow();
    Date.now = () => start + 121_000;
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await s.settle();
    assert.ok(s.text().includes("Don't close this tab"), `premise: the two-minute line renders; the panel reads: ${s.text().slice(0, 300)}`);
    const links = linksReading(s, 'Run it yourself');
    assert.deepEqual(links.map((a) => a.props.href), origin === null ? [] : [`${origin}${TARGET}`]);
    for (const a of links) {
      assert.equal(a.props.target, '_blank', 'the link no longer opens a new tab');
      assert.match(String(a.props.rel ?? ''), /noopener/, 'a new-tab link without noopener');
    }
    assert.ok(!/no limits/i.test(s.text()), 'the line still says "no limits"');
  });
}
