// UX-2 P6 + P10 (#729), the narration explainer's links: contract p6p10.md v5.2, criteria 22 (item 26) and 23 (item 27,
// as 0d item 7 shapes it), and D-21 (criterion 11's row for the explainer).
//
// THE RULE. "Learn more" goes through the host links, as `McpResponseDisplay`'s `/learn` links do: on a split topology
// it is the marketing origin's `/learn#narration`, and where the instance serves no marketing surface it is not shown.
// The three code links are a commit permalink, the same constant `/learn` uses (`blob/08dfa4c`, its three anchors),
// never `blob/main`, whose line anchors drift with the file.
//
// WHAT IS DRIVEN. The real `NarrationExplainer`, opened by its button, inside `HostLinksProvider`; the real `/learn`
// page for its code links.
//
// WHAT MAKES IT ABLE TO FAIL. At the base the link is the bare `/learn#narration` (a 404 from the app host), and the code
// links are `blob/main/...#L43-L71`, `#L319-L343`, `#L346-L370`, none equal to `/learn`'s.
//
// BLIND SPOTS, stated. Whether each anchor's first line declares its function at `08dfa4c` needs that commit's objects,
// which CI's shallow checkout does not hold (`ci.yml:29`): it is run locally and recorded in the gate record, not here.
//
// Run with: npm test

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ComponentType, ReactElement } from 'react';
import { NEXT_LINK_STUB, SRC, h, mount, registerSurfaceHooks, textOf, type Surface } from './sources/surface-test-harness.ts';

registerSurfaceHooks({ 'next/link': NEXT_LINK_STUB, 'next/script': 'export default function Script() { return null; }' });

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const NarrationExplainer = (await load('components/NarrationExplainer.tsx')).default as ComponentType;
const { HostLinksProvider } = await load('components/HostLinksProvider.tsx');
const learn = await load('app/(marketing)/learn/page.tsx');

const MARKETING = 'https://marketing.fixture.example';
const mounted: Surface[] = [];
afterEach(() => {
  for (const s of mounted.splice(0)) s.unmount();
});

async function opened(marketingOrigin: string | null): Promise<Surface> {
  const s = await mount(h(HostLinksProvider, { value: { marketingOrigin, signInHref: null } }, h(NarrationExplainer)));
  mounted.push(s);
  await s.click(s.button('How is this narration generated?'));
  await s.settle();
  return s;
}
const hrefs = (s: Surface, pattern: RegExp): string[] =>
  s.elements().filter((el) => el.type === 'a' && pattern.test(String(el.props.href ?? ''))).map((el) => String(el.props.href));

test('criterion 22 (item 26): on a split topology "Learn more" is the marketing origin\'s /learn#narration', async () => {
  assert.deepEqual(hrefs(await opened(MARKETING), /#narration$/), [`${MARKETING}/learn#narration`]);
});

test('criterion 22 (item 26): where the instance serves no marketing surface, the link is not shown', async () => {
  assert.deepEqual(hrefs(await opened(null), /#narration$/), []);
});

test('criterion 11, D-21: the link reads "Learn more about how this site works →"', async () => {
  const s = await opened('');
  const link = s.elements().filter((el) => el.type === 'a' && /#narration$/.test(String(el.props.href ?? '')));
  assert.deepEqual(link.map((a) => textOf(a)), ['Learn more about how this site works →']);
});

test('criterion 23 (item 27, 0d item 7): the three code links are a commit permalink, equal to /learn\'s', async () => {
  const STREAMING = /\/src\/lib\/streaming\.ts#L\d+-L\d+$/;
  const explainer = hrefs(await opened(''), STREAMING);
  const page = await mount((await (learn.default as () => ReactElement | Promise<ReactElement>)()) as ReactElement);
  mounted.push(page);
  const onLearn = hrefs(page, STREAMING);
  assert.equal(onLearn.length, 3, `premise: /learn carries three code links: ${JSON.stringify(onLearn)}`);
  assert.deepEqual(explainer.filter((href) => href.includes('/blob/main/')), [], 'a code link drifts with main');
  assert.ok(explainer.every((href) => /\/blob\/[0-9a-f]{7,40}\/src\/lib\/streaming\.ts#/.test(href)), `not a commit permalink: ${JSON.stringify(explainer)}`);
  assert.deepEqual([...explainer].sort(), [...onLearn].sort());
});
