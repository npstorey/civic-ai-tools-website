// S4 W2a (npstorey/civic-ai-tools#335): Settings' Data sources tab and the picker over groups, criteria B1 and B2, with
// the words of the owner's rulings of 2026-11-24 (C1 = A, C2 = B, C3-ALL = A, C6 = B, C9-L = A; P-1 = A, DR-8 A).
//
// WHAT IS DRIVEN. The real Settings overlay (and, for the picker, the real picker panel) on the surface harness,
// reading and writing through the REAL `/api/flows`, `/api/sources/consent` and decision handlers, signed out (the
// cookie), on a site that can ask at the pause (in loop, with the decision store). Two sizes:
//   - production's seven sources (Socrata, Data Commons, NYC Charter, Laws and Rules, NYC Checkbook, NYC City Record,
//     NYS Open Legislation, CKAN; B1's "six" is seven since CKAN, Seat read 7144206411): one group of two, Socrata and
//     NYC City Record, and five sources alone;
//   - the 200-source fixture, through the statement's test hook (A14) and the groups' (`reader-groups.ts`): Socrata
//     (157), Boston OpenContext (22), Data Commons (2) and NYC Checkbook (2), and 17 alone.
//
// THE SHAPES THAT CAN FAIL. A group's control is clicked with a member set on its own to the OTHER setting, so a write
// that set every member, a line that counted every member, or a control that drew a state as chosen is seen; the
// write's body is read, so a write per member is seen; the cookie is read back through the route's GET after the click.
// The rendered-text pin over S86 is read on the five rows alone, which at the base say card F's words.
//
// RED AT THE BASE (04c99df): every source is a row with a three-state radio group; there is no group, no count, no mark,
// no "Enable all data sources", and the line under an Ask-first row is card F's.
//
// BLIND SPOTS, stated. No layout or browser events: what a screen reader announces is read from the rendered roles,
// names and `aria-pressed` values, not from a screen reader; a disclosure's opening is its `onToggle` called as a
// browser would after a click.
//
// Run with: npm test

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ComponentType } from 'react';
import {
  CONSENT_SURFACE_STUBS,
  SRC,
  h,
  installFetch,
  mount,
  registerSurfaceHooks,
  sessions,
  textOf,
  type HostElement,
  type Surface,
} from '../sources/surface-test-harness.ts';
import { attr, parentOf, within } from '../ui/ui-test-helpers.ts';
import { FAKE_VERCEL_KV_MODULE, FakeDecisionKv } from '../../lib/sources/decision-store-for-tests.ts';

registerSurfaceHooks({ ...CONSENT_SURFACE_STUBS, '@vercel/kv': FAKE_VERCEL_KV_MODULE });

for (const name of [
  'NYC_CHARTER_HOSTING', 'NYC_CHECKBOOK_HOSTING', 'NYS_LEGISLATION_HOSTING', 'NYS_LEGISLATION_API_KEY', 'DATA_COMMONS_MCP_URL',
  'DATA_COMMONS_API_KEY', 'BOSTON_OPENCONTEXT_MCP_URL', 'CKAN_MCP_URL', 'MODEL_API_BASE_URL', 'VERCEL_ENV', 'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID', 'NEXT_PUBLIC_GA_MEASUREMENT_ID',
  'APP_HOST', 'NEXTAUTH_URL', 'SITE_DEPLOYMENT_GUIDE_URL', 'NEXT_PUBLIC_CAPTURE_TRACES', 'SITE_PORTAL_LOCKED', 'SITE_DEFAULT_PORTAL',
  'DATABASE_URL',
]) delete process.env[name];
// Production's seven (as W1's driven suite configures them).
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.DATA_COMMONS_MCP_URL = 'https://dc.fixture.example/mcp';
process.env.NYC_CHARTER_HOSTING = 'sandbox';
process.env.NYC_CHECKBOOK_HOSTING = 'sandbox';
process.env.NYS_LEGISLATION_HOSTING = 'sandbox';
process.env.NYS_LEGISLATION_API_KEY = 'fixture-key';
process.env.CKAN_MCP_URL = 'https://ckan.fixture.example/mcp';
// A site that can ask at the pause: in loop, with the decision store.
process.env.SOURCE_ROUTING = 'in-loop';
process.env.KV_REST_API_URL = 'https://kv.fixture.example';
process.env.KV_REST_API_TOKEN = 'fixture-kv';
process.env.EXECUTOR_DRIVER = 'none';
process.env.RATE_LIMIT_SECRET = 'fixture';
(globalThis as unknown as { __w2DecisionKv: FakeDecisionKv }).__w2DecisionKv = new FakeDecisionKv();

const ORIGIN = 'https://site.fixture.example';
const target = { addEventListener() {}, removeEventListener() {} };
Object.assign(globalThis as Record<string, unknown>, {
  window: { ...target, location: { href: `${ORIGIN}/settings`, origin: ORIGIN, pathname: '/settings', search: '' }, scrollTo() {} },
  document: { ...target, querySelector: () => null, querySelectorAll: () => [] },
});

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const SettingsOverlay = (await load('components/settings/SettingsOverlay.tsx')).default as ComponentType<Record<string, unknown>>;
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const decisionRoute = await load('app/api/sources/consent/decision/route.ts');
const flows = await load('lib/flows/statement.ts');
// The groups' test hook (absent at the base).
const groups = await load('lib/sources/reader-groups.ts').catch(() => null);
const fixture = JSON.parse(fs.readFileSync(path.join(SRC, 'lib', 'sources', 'fixtures', 'manifest-200.json'), 'utf8')) as { addresses: Record<string, string>; entries: Mod[] };

// --- The taken forms (planning's W2 words list, byte for byte) -------------------------------------------------------

const S = {
  S1: { two: 'two sources', 22: '22 sources', 157: '157 sources' },
  S2: {
    all157: 'Sets all 157, except any set on its own. A source set on its own keeps its own setting.',
    all22: 'Sets all 22, except any set on its own. A source set on its own keeps its own setting.',
    bothOneOwn: 'Sets both, except one set on its own. A source set on its own keeps its own setting.',
    both: 'Sets both. A source set on its own keeps its own setting.',
    // Drafted in S4 W2a fix round 1 (item 4), built as S2[1] and S2[2] are, for a group of two with both set on their
    // own; no ruled form. The owner rules it at W2's gate.
    bothBothOwn: 'Sets both, except any set on its own. A source set on its own keeps its own setting.',
  },
  S3: {
    all157: 'Sources reached through Socrata: Enable or Disable, for all 157, except any set on its own',
    both: 'Sources reached through Socrata: Enable or Disable, for both, except any set on its own',
  },
  S4: {
    oneOne: 'One source enabled, one disabled.',
    closed156: '156 sources enabled, one disabled.',
    twoNotAnswered: 'Two sources not answered yet.',
    closed22: '22 sources not answered yet: the site asks before it uses them.',
    closed157: '157 sources not answered yet: the site asks before it uses them.',
    open22: '22 sources not answered yet.',
  },
  S5: { 157: 'The 157 sources in this group', 22: 'The 22 sources in this group' },
  S6: { 157: '157 sources reached through Socrata are now enabled. This applies from your next question.' },
  S7: {
    one: 'One source reached through Socrata is now enabled. One set on its own was left as it is. This applies from your next question.',
    156: '156 sources reached through Socrata are now enabled. One set on its own was left as it is. This applies from your next question.',
  },
  S8: 'Nothing changed. Each source in this group is set on its own. Change each one on its own row.',
  S10: 'Set on its own: the group\'s control leaves it as it is.',
  S11: 'A source set on its own follows its group again once you set the group to that source\'s setting.',
  S42: { socrata: 'Sources reached through Socrata', boston: 'Sources reached through Boston OpenContext', checkbook: 'Sources reached through NYC Checkbook', dc: 'Sources reached through Data Commons' },
  S86: 'Not answered yet: the site asks before it uses this source.',
  S96: 'Enable all data sources',
  S97: {
    seven: 'All seven data sources are now enabled, including any you disabled. A source added later is not enabled until you enable it. This applies from your next question.',
    200: 'All 200 data sources are now enabled, including any you disabled. A source added later is not enabled until you enable it. This applies from your next question.',
  },
  S109: ['Enable', 'Disable'],
  S118: (name: string) => `${name}: Enable or Disable`,
};
/** Card F's words, the line under an Ask-first row at the base (item 54). */
const CARD_F = "Ask first: nothing is sent to this source until you turn it On, here or when the site asks you during a question. If you choose Allow then, it stays On for later questions. If you choose Don't allow, it is turned Off.";
// Moved by S4 W2a fix round 1 (item 3): PANEL_LEAD's drafted form, the ruled pairs applied.
const PANEL_LEAD = 'Set each data source to enabled or disabled. Your choice applies from your next question.';

const SEVEN = ['socrata', 'data-commons', 'nyc-charter', 'nyc-checkbook', 'nyc-record', 'nys-legislation', 'ckan-server'];
const ALONE_AT_SEVEN = ['data-commons', 'nyc-charter', 'nyc-checkbook', 'nys-legislation', 'ckan-server'];
const AUSTIN = 'datahub_austintexas_gov';

// --- The 200-source fixture, through both hooks ------------------------------------------------------------------------

function fixtureInputs(): Mod {
  return {
    manifest: fixture.entries,
    variantInForce: (entry: Mod) => entry.hostings[0],
    addressFor: (id: string) => fixture.addresses[fixture.entries.find((e) => e.sourceId === id)?.base ?? id],
  };
}

/** The fixture through the statement's hook, and through the groups' where it exists (at the base it does not, and the
 *  surface then fails at the criterion's own assertions). */
function at200(): void {
  flows.setFlowsSourceInputsForTests(fixtureInputs());
  groups?.setGroupManifestForTests?.(fixture.entries);
}

beforeEach(() => {
  flows.setFlowsSourceInputsForTests?.(null);
  groups?.setGroupManifestForTests?.(null);
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
});

// --- Driving -------------------------------------------------------------------------------------------------------------

type Net = ReturnType<typeof installFetch>;

function answers(): Net {
  return installFetch(ORIGIN, {
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent/decision': (request: Request) => (decisionRoute[request.method] as (r: Request) => Promise<Response>)(request),
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
  });
}

/** A consent in force through the real first-consent PUT: every configured source `fill` but those named. */
async function consented(states: Record<string, string>, own: string[] = [], fill = 'ask-first'): Promise<string[]> {
  const statement = await flows.buildFlowsStatement();
  const ids = (statement.sources as Mod[]).map((s) => s.sourceId as string);
  const all = Object.fromEntries(ids.map((id) => [id, states[id] ?? fill]));
  const written = await fetch('/api/sources/consent', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ states: all, own, flowsVersion: flows.statementHash(statement) }) });
  assert.equal(written.status, 200, `premise: the consent was written: ${await written.text()}`);
  return ids;
}

/** What the store holds now, through the route's own GET. */
async function stored(): Promise<{ states: Record<string, string>; own: string[] }> {
  const body = (await (await fetch('/api/sources/consent', { method: 'GET' })).json()) as Mod;
  return { states: Object.fromEntries(Object.entries(body.states ?? {}).map(([id, e]) => [id, (e as Mod).state as string])), own: body.setOnItsOwn ?? [] };
}

async function overlay(props: Record<string, unknown> = {}): Promise<Surface> {
  const s = await mount(h(SettingsOverlay, props));
  await s.settle();
  return s;
}

const rowOf = (s: Surface, id: string): HostElement => {
  const rows = s.elements().filter((el) => el.type === 'li' && el.props['data-source'] === id);
  assert.equal(rows.length, 1, `no one row for ${id} (found ${rows.length})`);
  return rows[0];
};
const groupOf = (s: Surface, classId: string): HostElement => {
  const found = s.elements().filter((el) => el.props['data-group'] === classId);
  assert.equal(found.length, 1, `no one group for ${classId} (found ${found.length})`);
  return found[0];
};
const groupsIn = (s: Surface) => s.elements().filter((el) => typeof el.props['data-group'] === 'string').map((el) => el.props['data-group'] as string);

/** The first two-button control under `el` (a row's, or a group's head), as a screen reader is told it. */
function controlOf(el: HostElement): { name: string | null; described: string | null; buttons: Array<{ word: string; pressed: string | null; el: HostElement }> } {
  const group = [el, ...within(el)].find((node) => attr(node, 'role') === 'group');
  assert.ok(group, `no role="group" control under this element: ${textOf(el).slice(0, 300)}`);
  const buttons = within(group).filter((node) => node.type === 'button').map((b) => ({ word: textOf(b), pressed: attr(b, 'aria-pressed'), el: b }));
  return { name: attr(group, 'aria-label'), described: attr(group, 'aria-describedby'), buttons };
}
const pressedOf = (el: HostElement) => controlOf(el).buttons.filter((b) => b.pressed === 'true').map((b) => b.word);
async function choose(s: Surface, el: HostElement, word: 'Enable' | 'Disable'): Promise<void> {
  const button = controlOf(el).buttons.find((b) => b.word === word);
  assert.ok(button, `no ${word} button`);
  await s.click(button.el);
  await s.settle();
}
/** The text of the elements an `aria-describedby` names. */
const describedText = (s: Surface, ids: string | null) =>
  (ids ?? '').split(/\s+/).filter(Boolean).map((id) => textOf(s.elements().find((el) => el.props.id === id) ?? h('i', null))).join(' | ');
const statusIn = (el: HostElement) => [el, ...within(el)].filter((node) => attr(node, 'role') === 'status').map(textOf);
const putsOf = (net: Net) => net.sent.filter((r) => r.method === 'PUT' && r.path === '/api/sources/consent');

// =====================================================================================================================
// B1 (red), at production's seven
// =====================================================================================================================

test('B1 (red): at seven, Socrata and NYC City Record are one group with its name, count, one control and S2; the five others are rows as today, renamed', async () => {
  const net = answers();
  await consented({});
  const s = await overlay();
  assert.deepEqual(groupsIn(s), ['socrata'], 'the groups at seven');
  const group = groupOf(s, 'socrata');
  const head = textOf(group);
  for (const words of [S.S42.socrata, S.S1.two, S.S2.both, S.S4.twoNotAnswered]) assert.ok(head.includes(words), `the group's head lacks "${words}": ${head.slice(0, 400)}`);
  assert.equal(controlOf(group).name, S.S3.both, 'the group control\'s accessible name (S3[2])');
  assert.deepEqual(pressedOf(group), [], 'a group of sources not answered yet shows neither button pressed');
  // Its two rows sit inside it, with no disclosure (twelve or fewer).
  for (const id of ['socrata', 'nyc-record']) {
    const row = rowOf(s, id);
    assert.ok(within(group).includes(row), `${id}'s row is not inside its group`);
  }
  assert.equal(within(group).filter((el) => el.type === 'details' && !textOf(el).startsWith('More about this source')).length, 0, 'a group of two is closed behind a disclosure');
  // The five alone: no group, two buttons with today's words, neither pressed, and S86 under them.
  for (const id of ALONE_AT_SEVEN) {
    const row = rowOf(s, id);
    assert.equal(s.elements().some((el) => typeof el.props['data-group'] === 'string' && within(el).includes(row)), false, `${id} is inside a group`);
    const control = controlOf(row);
    assert.deepEqual(control.buttons.map((b) => b.word), S.S109, `${id}'s control is not Enable and Disable`);
    assert.deepEqual(control.buttons.map((b) => b.pressed), ['false', 'false'], `${id}, not answered yet, shows a button pressed`);
    assert.equal(within(row).filter((el) => el.type === 'input' && el.props.type === 'radio').length, 0, `${id} still has radios`);
  }
  net.clear();
  s.unmount();
});

test('B1 (red; rendered-text pin over S86): each source not answered yet reads S86 under its control, byte for byte, and not card F\'s words', async () => {
  answers();
  await consented({});
  const s = await overlay();
  for (const id of SEVEN) {
    const text = textOf(rowOf(s, id));
    assert.ok(text.includes(S.S86), `${id}'s row does not read S86: ${text.slice(0, 300)}`);
    assert.ok(!text.includes(CARD_F), `${id}'s row still reads card F's words`);
  }
  s.unmount();
});

test('B1 (red; the control\'s accessible state, S4-6): for each stored state, the pair\'s names and aria-pressed, and the line it is described by', async () => {
  answers();
  await consented({ 'data-commons': 'on', 'nyc-charter': 'off' }, ['nyc-charter']);
  const s = await overlay();
  const read = (id: string) => {
    const control = controlOf(rowOf(s, id));
    return { name: control.name, buttons: control.buttons.map((b) => `${b.word}:${b.pressed}`), described: describedText(s, control.described) };
  };
  assert.deepEqual(read('data-commons'), { name: S.S118('Data Commons'), buttons: ['Enable:true', 'Disable:false'], described: '' }, 'enabled');
  assert.deepEqual(read('nyc-charter'), { name: S.S118('NYC Charter, Laws and Rules'), buttons: ['Enable:false', 'Disable:true'], described: '' }, 'disabled (alone, so no mark)');
  assert.deepEqual(read('nyc-checkbook'), { name: S.S118('NYC Checkbook'), buttons: ['Enable:false', 'Disable:false'], described: S.S86 }, 'not answered yet');
  // A click on the pressed button writes nothing (there is no way back to "not answered yet", DR-8 A).
  s.unmount();
});

test('B1 (red): at seven, a source set on its own inside the group carries the mark, S10; a source alone set Off does not', async () => {
  answers();
  await consented({ 'nyc-record': 'off', 'nyc-charter': 'off' }, ['nyc-record', 'nyc-charter']);
  const s = await overlay();
  const record = textOf(rowOf(s, 'nyc-record'));
  assert.ok(record.includes(S.S10), `NYC City Record, set on its own in a group, lacks the mark: ${record.slice(0, 300)}`);
  assert.ok(!textOf(rowOf(s, 'socrata')).includes(S.S10), 'Socrata, not set on its own, carries the mark');
  assert.ok(!textOf(rowOf(s, 'nyc-charter')).includes(S.S10), 'NYC Charter, alone, carries the mark');
  assert.ok(textOf(groupOf(s, 'socrata')).includes(S.S2.bothOneOwn), 'the group of two with one set on its own does not read S2[3]');
  s.unmount();
});

// =====================================================================================================================
// B1 (red), at 200 from the fixture
// =====================================================================================================================

test('B1 (red): at 200, the four groups each render their name, count and one control; the closed two open by S5; the 17 alone are rows', async () => {
  at200();
  answers();
  await consented({});
  const s = await overlay();
  assert.deepEqual(groupsIn(s), ['socrata', 'nyc-checkbook', 'boston-opencontext', 'data-commons'], 'the groups at 200, in manifest order');
  const expect: Record<string, { name: string; count: string; closed: string | null }> = {
    socrata: { name: S.S42.socrata, count: S.S1[157], closed: S.S5[157] },
    'boston-opencontext': { name: S.S42.boston, count: S.S1[22], closed: S.S5[22] },
    'nyc-checkbook': { name: S.S42.checkbook, count: S.S1.two, closed: null },
    'data-commons': { name: S.S42.dc, count: S.S1.two, closed: null },
  };
  for (const [classId, want] of Object.entries(expect)) {
    const group = groupOf(s, classId);
    const text = textOf(group);
    assert.ok(text.startsWith(`${want.name} ${want.count}`), `${classId}'s head: ${text.slice(0, 200)}`);
    const controls = [group, ...within(group)].filter((el) => attr(el, 'role') === 'group');
    assert.ok(controls.length >= 1, `${classId} has no control`);
    const disclosures = within(group).filter((el) => el.type === 'details' && el.props['data-part'] !== 'row-more' && !textOf(el).startsWith('More about this source'));
    if (want.closed === null) assert.equal(disclosures.length, 0, `${classId} (two) is behind a disclosure`);
    else {
      assert.equal(disclosures.length, 1, `${classId} has no one disclosure`);
      assert.equal(attr(disclosures[0], 'open'), null, `${classId}'s disclosure is open before it is opened`);
      assert.ok(textOf(disclosures[0]).startsWith(want.closed), `${classId}'s disclosure is not "${want.closed}"`);
    }
  }
  assert.equal(controlOf(groupOf(s, 'socrata')).name, S.S3.all157, 'S3[1]');
  assert.ok(textOf(groupOf(s, 'socrata')).includes(S.S2.all157), 'S2[1]');
  assert.ok(textOf(groupOf(s, 'socrata')).includes(S.S4.closed157), 'S4[6], closed');
  assert.ok(textOf(groupOf(s, 'boston-opencontext')).includes(S.S2.all22), 'S2[2]');
  assert.ok(textOf(groupOf(s, 'boston-opencontext')).includes(S.S4.closed22), 'S4[5], closed');
  s.unmount();
});

// Holds at the base, where every row is in view and one action reaches its "More about this source"; it is the guard
// that grouping does not put a row further away. Shown able to fail by a planted second disclosure (the phase report).
test('B1 (holds at the base): at 200, every source\'s row and its "More about this source" are reachable in two actions', async () => {
  at200();
  answers();
  const ids = await consented({});
  const s = await overlay();
  assert.equal(ids.length, 200, 'premise: 200 sources are configured');
  const over: string[] = [];
  for (const id of ids) {
    const row = rowOf(s, id);
    // Actions: each closed disclosure between the list and the row, then the row's own "More about this source".
    let closed = 0;
    for (let up = parentOf(s, row); up !== null; up = parentOf(s, up)) if (up.type === 'details' && attr(up, 'open') === null) closed += 1;
    const more = within(row).filter((el) => el.type === 'details' && textOf(el).startsWith('More about this source'));
    if (more.length !== 1 || closed + 1 > 2) over.push(`${id}: ${closed} closed disclosure(s) above, ${more.length} "More about this source"`);
  }
  assert.deepEqual(over, [], 'rows not reachable in two actions');
  s.unmount();
});

test('B1 (red): at 200, the source set on its own carries S10; opening the group shows the rows\' form of S4; search still filters, flat, the mark kept', async () => {
  at200();
  const net = answers();
  await consented({ [AUSTIN]: 'off' }, [AUSTIN]);
  const s = await overlay();
  net.clear();
  assert.ok(textOf(rowOf(s, AUSTIN)).includes(S.S10), 'City Data Hub | City of Austin, set on its own, lacks the mark');
  assert.ok(!textOf(rowOf(s, 'socrata')).includes(S.S10), 'Socrata carries the mark');
  // The Boston group, closed: S4[5]; opened (one action): S4[8], the rows' form.
  const boston = groupOf(s, 'boston-opencontext');
  assert.ok(textOf(boston).includes(S.S4.closed22), 'closed Boston group: S4[5]');
  const disclosure = within(boston).find((el) => el.type === 'details' && textOf(el).startsWith(S.S5[22]))!;
  (disclosure.props.onToggle as (e: unknown) => void)({ currentTarget: { open: true } });
  await s.settle();
  const opened = groupOf(s, 'boston-opencontext');
  assert.ok(textOf(opened).includes(S.S4.open22) && !textOf(opened).includes(S.S4.closed22), `opened Boston group: S4[8]: ${textOf(opened).slice(0, 300)}`);
  // Search: the matching rows alone, flat, with the count line; the mark stays on the row.
  const search = s.elements().find((el) => el.type === 'input' && el.props.type === 'search')!;
  await s.type(search, 'Austin');
  await s.settle();
  assert.deepEqual(groupsIn(s), [], 'a search still shows the groups');
  const listed = s.elements().filter((el) => el.type === 'li' && typeof el.props['data-source'] === 'string').map((el) => el.props['data-source']);
  assert.ok(listed.includes(AUSTIN) && listed.length < 200, `the search did not filter: ${listed.length} rows`);
  assert.ok(textOf(rowOf(s, AUSTIN)).includes(S.S10), 'the searched row lost its mark');
  assert.equal(putsOf(net).length, 0, 'reading wrote');
  s.unmount();
});

// =====================================================================================================================
// B2 (red): a group's control
// =====================================================================================================================

test('B2 (red): at 200, Enable on the Socrata head writes once, by class; the source set on its own stays Disabled; S7[2]; S4[3]; neither pressed', async () => {
  at200();
  const net = answers();
  await consented({ [AUSTIN]: 'off' }, [AUSTIN]);
  const s = await overlay();
  net.clear();
  await choose(s, groupOf(s, 'socrata'), 'Enable');
  const puts = putsOf(net);
  assert.equal(puts.length, 1, `the group's control wrote ${puts.length} times`);
  assert.deepEqual(JSON.parse(puts[0].body).change, { scope: 'class', classId: 'socrata', state: 'on' }, 'the write is not the class write');
  const after = await stored();
  const members = fixture.entries.filter((e) => (e.base ?? e.sourceId) === 'socrata').map((e) => e.sourceId as string);
  assert.equal(members.length, 157, 'premise: 157 in the Socrata class');
  assert.deepEqual(members.filter((id) => after.states[id] !== 'on'), [AUSTIN], 'every member but the one set on its own is enabled');
  assert.equal(after.states[AUSTIN], 'off');
  assert.ok(after.own.includes(AUSTIN), 'the flag on the source set on its own was cleared');
  assert.equal(after.states['boston-opencontext'], 'ask-first', 'a source outside the class moved');
  const group = groupOf(s, 'socrata');
  assert.deepEqual(statusIn(group), [S.S7[156]], 'the line after the click (S7[2])');
  assert.deepEqual(pressedOf(group), [], 'the control draws a state as chosen while its members differ');
  assert.ok(textOf(group).includes(S.S4.closed156), 'S4[3] under the control');
  s.unmount();
});

test('B2 (red): at 200 with none set on its own, Enable on the Socrata head enables all 157, says S6[1], and draws Enable pressed', async () => {
  at200();
  const net = answers();
  await consented({});
  const s = await overlay();
  net.clear();
  await choose(s, groupOf(s, 'socrata'), 'Enable');
  assert.equal(putsOf(net).length, 1);
  const group = groupOf(s, 'socrata');
  assert.deepEqual(statusIn(group), [S.S6[157]]);
  assert.deepEqual(pressedOf(group), ['Enable']);
  assert.ok(!textOf(group).includes('not answered yet'), 'the states line stays once every member is enabled');
  s.unmount();
});

test('B2 (red): at seven, from NYC City Record disabled on its own, Enable on the group enables Socrata alone and says S7[1]; S4[1] then counts them', async () => {
  const net = answers();
  await consented({ 'nyc-record': 'off' }, ['nyc-record']);
  const s = await overlay();
  net.clear();
  await choose(s, groupOf(s, 'socrata'), 'Enable');
  assert.equal(putsOf(net).length, 1);
  assert.deepEqual(JSON.parse(putsOf(net)[0].body).change, { scope: 'class', classId: 'socrata', state: 'on' });
  const after = await stored();
  assert.deepEqual([after.states.socrata, after.states['nyc-record']], ['on', 'off']);
  const group = groupOf(s, 'socrata');
  assert.deepEqual(statusIn(group), [S.S7.one]);
  assert.ok(textOf(group).includes(S.S4.oneOne), `S4[1]: ${textOf(group).slice(0, 300)}`);
  assert.deepEqual(pressedOf(group), []);
  assert.deepEqual(pressedOf(rowOf(s, 'socrata')), ['Enable']);
  assert.deepEqual(pressedOf(rowOf(s, 'nyc-record')), ['Disable']);
  s.unmount();
});

test('B2 (red): at seven, with both members set on their own to Disable, Enable on the group changes nothing and says S8', async () => {
  const net = answers();
  await consented({ socrata: 'off', 'nyc-record': 'off' }, ['socrata', 'nyc-record']);
  const s = await overlay();
  net.clear();
  await choose(s, groupOf(s, 'socrata'), 'Enable');
  const after = await stored();
  assert.deepEqual([after.states.socrata, after.states['nyc-record']], ['off', 'off'], 'a source set on its own moved');
  assert.deepEqual(statusIn(groupOf(s, 'socrata')), [S.S8]);
  s.unmount();
});

// =====================================================================================================================
// "Enable all data sources" (C3-ALL = A; S96, S97) and "About these settings" (S11)
// =====================================================================================================================

test('C3-ALL (red): "Enable all data sources" sits above the rows; one write enables every source and clears every mark; S97[1] at seven', async () => {
  const net = answers();
  await consented({ socrata: 'on', 'nyc-record': 'off' }, ['nyc-record']);
  const s = await overlay();
  const button = s.button(S.S96);
  const order = s.elements();
  assert.ok(order.indexOf(button) < order.indexOf(rowOf(s, 'socrata')), 'the button is not above the rows');
  net.clear();
  await s.click(button);
  await s.settle();
  const puts = putsOf(net);
  assert.equal(puts.length, 1);
  assert.deepEqual(JSON.parse(puts[0].body).change, { scope: 'all', state: 'on' });
  const after = await stored();
  assert.deepEqual(SEVEN.filter((id) => after.states[id] !== 'on'), [], 'a source is not enabled');
  assert.deepEqual(after.own, [], 'a flag survived');
  assert.ok(s.text().includes(S.S97.seven), 'S97[1] is not shown');
  assert.ok(!textOf(rowOf(s, 'nyc-record')).includes(S.S10), 'the mark survived');
  for (const id of SEVEN) assert.deepEqual(pressedOf(rowOf(s, id)), ['Enable'], `${id} is not drawn enabled`);
  s.unmount();
});

test('C3-ALL (red): at 200, "Enable all data sources" says S97[2]', async () => {
  at200();
  answers();
  await consented({ [AUSTIN]: 'off' }, [AUSTIN]);
  const s = await overlay();
  await s.click(s.button(S.S96));
  await s.settle();
  assert.ok(s.text().includes(S.S97[200]));
  assert.deepEqual(pressedOf(groupOf(s, 'socrata')), ['Enable']);
  s.unmount();
});

test('C2 = B (red): "About these settings" reads S11 after the tab\'s first sentence', async () => {
  answers();
  const s = await overlay({ initialTab: 'about' });
  const text = s.text();
  const lead = text.indexOf(PANEL_LEAD);
  assert.ok(lead >= 0, 'the tab\'s first sentence is not PANEL_LEAD\'s drafted form (moved by S4 W2a fix round 1)');
  assert.ok(text.indexOf(S.S11) > lead, `S11 does not follow it: ${text.slice(0, 500)}`);
  s.unmount();
});

// =====================================================================================================================
// The picker: the same grouping (C1 = A)
// =====================================================================================================================

test('C1 (red): the picker, before any words, lists Settings\' grouping: the Socrata group with its count and control, each row with its pick', async () => {
  answers();
  await consented({});
  const hook = await load('components/sources/useSourceConsent.ts');
  const PickerPanel = (await load('components/composer/picks/PickerPanel.tsx')).default as ComponentType<Record<string, unknown>>;
  const s = await mount(h(PickerPanel, { docked: false }));
  await hook.refreshConsent();
  await s.settle();
  assert.deepEqual(groupsIn(s), ['socrata'], 'the picker\'s groups at seven');
  const group = groupOf(s, 'socrata');
  assert.ok(textOf(group).startsWith(`${S.S42.socrata} ${S.S1.two}`), `the picker's group head: ${textOf(group).slice(0, 200)}`);
  assert.equal(controlOf(group).name, S.S3.both);
  for (const id of SEVEN) {
    const row = rowOf(s, id);
    assert.equal(within(row).filter((el) => el.props['data-part'] === 'pick-control').length, 1, `${id}'s row has no pick`);
  }
  s.unmount();
});

// =====================================================================================================================
// The paths the criteria pass through (fix commit): before a consent, at the cookie's bound, a landing, a flagged Ask
// first
// =====================================================================================================================

test('B2, before a consent: a group\'s control keeps its states on the page and writes nothing; Allow then marks only the source set by its own control', async () => {
  const net = answers();
  const s = await overlay();
  assert.equal(s.elements().some((el) => el.props.role === 'status'), false, 'premise: nothing confirmed');
  net.clear();
  await choose(s, rowOf(s, 'nyc-charter'), 'Disable');
  await choose(s, groupOf(s, 'socrata'), 'Disable');
  assert.deepEqual(net.sent.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.path}`), [], 'a change before a consent wrote');
  assert.deepEqual(pressedOf(groupOf(s, 'socrata')), ['Disable'], 'the group\'s pending state is not shown');
  assert.deepEqual(statusIn(groupOf(s, 'socrata')), [], 'a pending group change was confirmed');
  const hook = await load('components/sources/useSourceConsent.ts');
  assert.equal(await hook.allowConsent(), true, 'premise: Allow wrote');
  const put = net.sent.filter((r) => r.method === 'PUT' && r.path === '/api/sources/consent').pop()!;
  const body = JSON.parse(put.body) as { states: Record<string, string>; own: string[] };
  assert.deepEqual([body.states.socrata, body.states['nyc-record'], body.states['nyc-charter']], ['off', 'off', 'off']);
  assert.deepEqual(body.own, ['nyc-charter'], 'Allow marked a source a group\'s control set');
  s.unmount();
});

test('B2 at the cookie\'s bound: a group\'s write the endpoint refuses says S24 under the group\'s control, which stays live', async () => {
  const socrata = fixture.entries.find((e) => e.sourceId === 'socrata')!;
  const entries = [
    ...fixture.entries,
    ...Array.from({ length: 100 }, (_, i) => ({ kind: 'pack', sourceId: `example-pack-${String(i).padStart(3, '0')}`, alias: `example_pack_${i}`, displayName: `Example pack ${i}`, freshness: 'Example: an example pack.', base: 'socrata', consentDefault: 'on', hostings: socrata.hostings })),
  ];
  flows.setFlowsSourceInputsForTests({ manifest: entries, variantInForce: (e: Mod) => e.hostings[0], addressFor: (id: string) => fixture.addresses[entries.find((e) => e.sourceId === id)?.base ?? id] });
  groups?.setGroupManifestForTests?.(entries);
  const net = answers();
  const consent = await load('lib/sources/consent.ts');
  const statement = await flows.buildFlowsStatement();
  const ids = (statement.sources as Mod[]).map((x) => x.sourceId as string);
  assert.equal(ids.length, 300, 'premise: 300 sources');
  // 274 stored states, the most the second form holds: every source outside the Socrata class, then Socrata's own until
  // the cookie is full, so the class's write adds entries for the 26 members with none, which the cookie cannot hold.
  const socrataClass = new Set(entries.filter((e) => (e.base ?? e.sourceId) === 'socrata').map((e) => e.sourceId as string));
  const stored = [...ids.filter((id) => !socrataClass.has(id)), ...ids.filter((id) => socrataClass.has(id))].slice(0, 274);
  const value = consent.encodeConsentCookie({ v: 2, flows: statement.version, states: Object.fromEntries(stored.map((id) => [id, { state: 'ask-first', since: '2026-11-01', version: (statement.sources as Mod[]).find((x) => x.sourceId === id)!.version }])) });
  net.jar.set(consent.CONSENT_COOKIE_NAME, value);
  const s = await overlay();
  net.clear();
  await choose(s, groupOf(s, 'socrata'), 'Enable');
  assert.equal(putsOf(net).length, 1, 'premise: the click wrote once');
  assert.equal(net.jar.get(consent.CONSENT_COOKIE_NAME), value, 'the cookie changed');
  assert.deepEqual(statusIn(groupOf(s, 'socrata')), ['This change was not saved. Your settings are kept in a cookie, and it is full.']);
  const control = controlOf(groupOf(s, 'socrata'));
  assert.deepEqual(control.buttons.filter((b) => b.el.props.disabled === true), [], 'the group\'s control is held after the refusal');
  s.unmount();
});

test('B1, a landing: Settings opened for a source inside a closed group opens that group', async () => {
  at200();
  answers();
  await consented({});
  const location = (globalThis as unknown as { window: { location: { search: string } } }).window.location;
  location.search = `?source=${AUSTIN}`;
  try {
    const s = await overlay();
    const socrata = within(groupOf(s, 'socrata')).find((el) => el.type === 'details' && textOf(el).startsWith(S.S5[157]))!;
    assert.equal(attr(socrata, 'open'), '', 'the group holding the landed source is closed');
    const boston = within(groupOf(s, 'boston-opencontext')).find((el) => el.type === 'details' && textOf(el).startsWith(S.S5[22]))!;
    assert.equal(attr(boston, 'open'), null, 'another group opened');
    s.unmount();
  } finally {
    location.search = '';
  }
});

test('#826\'s cost, read: a stored Ask first that carries the flag renders neither button pressed, S86, and the mark in its group', async () => {
  answers();
  await consented({ 'nyc-record': 'ask-first' }, ['nyc-record']);
  const s = await overlay();
  const record = rowOf(s, 'nyc-record');
  assert.deepEqual(pressedOf(record), []);
  assert.ok(textOf(record).includes(S.S86), 'no S86');
  assert.ok(textOf(record).includes(S.S10), 'no mark');
  // A group's Enable leaves it as it is (premise 7's "Honoured"), and says so.
  await choose(s, groupOf(s, 'socrata'), 'Enable');
  assert.deepEqual(statusIn(groupOf(s, 'socrata')), [S.S7.one]);
  assert.deepEqual(pressedOf(rowOf(s, 'nyc-record')), []);
  s.unmount();
});

// =====================================================================================================================
// Fix round 1 (the seat's ruling, hub #335 comment 7228846086)
// =====================================================================================================================

/** A consent cookie asked again (its base version is not the statement's), holding `states` with their flags. */
async function askedAgainCookie(net: Net, states: Record<string, { state: string; own?: boolean }>): Promise<void> {
  const consent = await load('lib/sources/consent.ts');
  const statement = await flows.buildFlowsStatement();
  const value = consent.encodeConsentCookie({
    v: 2,
    flows: '0'.repeat(64),
    states: Object.fromEntries(Object.entries(states).map(([id, s]) => [id, { ...s, since: '2026-11-01', version: (statement.sources as Mod[]).find((x) => x.sourceId === id)!.version }])),
  });
  net.jar.set(consent.CONSENT_COOKIE_NAME, value);
  const status = (await (await fetch('/api/sources/consent', { method: 'GET' })).json()) as Mod;
  assert.equal(status.inForce, false, 'premise: the cookie is asked again');
}

// Fix round 2 (the seat's ruling 7229359694): round 1's rule applies to a marked write only (`ownComplete: true`, beside
// `own` in the PUT body), which the base client never sends; an unmarked write reads as the base, `own` present or not.
test('FR2 (red): a marked write (`ownComplete: true`) writes no flag but its own; an unmarked one reads as the base, with `own: []` or without `own`', async () => {
  const statement = await flows.buildFlowsStatement();
  const ids = (statement.sources as Mod[]).map((s) => s.sourceId as string);
  const states = Object.fromEntries(ids.map((id) => [id, id === 'socrata' ? 'off' : 'ask-first']));
  for (const [label, body, want] of [
    ['marked, own: []', { states, own: [], ownComplete: true, flowsVersion: flows.statementHash(statement) }, []],
    ['unmarked, own: []', { states, own: [], flowsVersion: flows.statementHash(statement) }, ['socrata']],
    ['unmarked, without own', { states, flowsVersion: flows.statementHash(statement) }, ['socrata']],
  ] as const) {
    answers();
    const written = await fetch('/api/sources/consent', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(written.status, 200, `premise (${label})`);
    assert.deepEqual((await stored()).own, want, `${label}: the sources read as set on their own`);
  }
});

test('FR1 item 1 (red): a group\'s Disable before a first consent is not set on its own after Allow', async () => {
  const net = answers();
  const s = await overlay();
  await choose(s, groupOf(s, 'socrata'), 'Disable');
  const hook = await load('components/sources/useSourceConsent.ts');
  net.clear();
  assert.equal(await hook.allowConsent(), true, 'premise: Allow wrote');
  const after = await stored();
  assert.deepEqual([after.states.socrata, after.states['nyc-record']], ['off', 'off'], 'premise: the group\'s Disable was written');
  assert.deepEqual(after.own, [], 'a group\'s Disable came out set on its own');
  s.unmount();
});

test('FR1 item 1, FR2 (red): the new client\'s Allow always sends `own`, empty when nothing is set on its own, and marks the write', async () => {
  const net = answers();
  const s = await overlay();
  const hook = await load('components/sources/useSourceConsent.ts');
  net.clear();
  assert.equal(await hook.allowConsent(), true);
  const body = JSON.parse(putsOf(net)[0].body) as Mod;
  assert.ok(Object.hasOwn(body, 'own'), 'Allow sent no `own`');
  assert.deepEqual(body.own, []);
  // Fix round 2: the new client marks its write.
  assert.equal(body.ownComplete, true, 'Allow did not mark its write (`ownComplete: true`)');
  s.unmount();
});

test('FR1 item 1 (red): on a consent asked again, the new client\'s Allow keeps the stored flags, sending them in `own`', async () => {
  const net = answers();
  await askedAgainCookie(net, { socrata: { state: 'on', own: true }, 'nyc-charter': { state: 'off', own: true }, 'data-commons': { state: 'on', own: false } });
  const s = await overlay();
  const hook = await load('components/sources/useSourceConsent.ts');
  net.clear();
  assert.equal(await hook.allowConsent(), true);
  assert.deepEqual([...(JSON.parse(putsOf(net)[0].body) as Mod).own].sort(), ['nyc-charter', 'socrata'], 'Allow did not send the stored flags');
  const after = await stored();
  assert.deepEqual([...after.own].sort(), ['nyc-charter', 'socrata'], 'a stored flag was lost or added');
  s.unmount();
});

// Fix round 2 (replaces round 1's cost test, whose expectation is now the opposite): the write the base client at
// 04c99df sends on a consent asked again (`useSourceConsent.ts:432-434` there): every state, `own` the sources changed
// before the answer ([] when none), no marker. Driven through the real PUT, for the cookie and for the account.
const STORED_FLAGS = { socrata: { state: 'on', own: true }, 'nyc-charter': { state: 'off', own: true }, 'nyc-record': { state: 'off', own: false }, 'data-commons': { state: 'ask-first', own: false } } as const;
for (const store of ['cookie', 'account'] as const) {
  for (const [shape, own] of [['empty', []], ['partial', ['nyc-checkbook']]] as const) {
    test(`FR2 (red), ${store}: an unmarked write shaped as the base client sends it, own ${shape}, on a consent asked again, leaves every stored flag as it was`, async () => {
      const net = answers();
      const statement = await flows.buildFlowsStatement();
      const ids = (statement.sources as Mod[]).map((x) => x.sourceId as string);
      if (store === 'cookie') {
        await askedAgainCookie(net, STORED_FLAGS);
      } else {
        // A row asked again: it holds a statement with one base recipient fewer, so the current one adds a recipient.
        sessions.server = { user: { id: 'gh-fixture-account', dbId: 'fr2-fixture-row' } };
        (sessions as unknown as { rows: Map<string, unknown> }).rows.set('fr2-fixture-row', {
          userId: 'fr2-fixture-row',
          states: Object.fromEntries(Object.entries(STORED_FLAGS).map(([id, s]) => [id, { ...s, since: '2026-11-01' }])),
          flowsHash: '0'.repeat(64),
          flowsStatement: { ...statement, recipients: statement.recipients.slice(1) },
          consentedAt: new Date(),
          updatedAt: new Date(),
        });
        const status = (await (await fetch('/api/sources/consent', { method: 'GET' })).json()) as Mod;
        assert.equal(status.inForce, false, 'premise: the row is asked again');
      }
      const before = await stored();
      assert.deepEqual([...before.own].sort(), ['nyc-charter', 'socrata'], 'premise: the stored flags');
      const states = Object.fromEntries(ids.map((id) => [id, (STORED_FLAGS as Record<string, { state: string }>)[id]?.state ?? (id === 'nyc-checkbook' ? 'on' : 'ask-first')]));
      const written = await fetch('/api/sources/consent', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ states, own, flowsVersion: flows.statementHash(statement) }) });
      assert.equal(written.status, 200, `premise: the write was taken: ${await written.clone().text()}`);
      const after = await stored();
      const want = own.length > 0 ? ['nyc-charter', 'nyc-checkbook', 'socrata'] : ['nyc-charter', 'socrata'];
      assert.deepEqual([...after.own].sort(), want, 'an unmarked write moved a stored flag');
      sessions.server = null;
    });
  }
}

test('FR1 item 2 (red): "Enable all data sources" before a consent clears every flag once Allow writes', async () => {
  const net = answers();
  await askedAgainCookie(net, { socrata: { state: 'on', own: true }, 'nyc-charter': { state: 'off', own: true } });
  const s = await overlay();
  await s.click(s.button(S.S96));
  await s.settle();
  assert.deepEqual(net.sent.filter((r) => r.method === 'PUT'), [], 'premise: nothing written before Allow');
  const hook = await load('components/sources/useSourceConsent.ts');
  assert.equal(await hook.allowConsent(), true);
  const after = await stored();
  assert.deepEqual(SEVEN.filter((id) => after.states[id] !== 'on'), [], 'a source is not enabled');
  assert.deepEqual(after.own, [], 'a flag survived "Enable all data sources"');
  s.unmount();
});

test('FR1 item 1, premise 7\'s "Cleared" before a consent: a group\'s Disable clears the flag of a member already disabled on its own, once Allow writes', async () => {
  const net = answers();
  await askedAgainCookie(net, { socrata: { state: 'on', own: false }, 'nyc-record': { state: 'off', own: true }, 'nyc-charter': { state: 'off', own: true } });
  const s = await overlay();
  await choose(s, groupOf(s, 'socrata'), 'Disable');
  const hook = await load('components/sources/useSourceConsent.ts');
  assert.equal(await hook.allowConsent(), true);
  const after = await stored();
  assert.deepEqual([after.states.socrata, after.states['nyc-record']], ['off', 'off']);
  assert.deepEqual(after.own, ['nyc-charter'], 'the member\'s flag was not cleared, or a flag outside the group was');
  s.unmount();
});

test('FR1 item 4 (red): a group of two with both set on their own reads the drafted S2 form', async () => {
  answers();
  await consented({ socrata: 'off', 'nyc-record': 'off' }, ['socrata', 'nyc-record']);
  const s = await overlay();
  assert.ok(textOf(groupOf(s, 'socrata')).includes(S.S2.bothBothOwn), `S2: ${textOf(groupOf(s, 'socrata')).slice(0, 300)}`);
  s.unmount();
});

test('A14\'s rule for the groups\' hook: no app module calls setGroupManifestForTests', () => {
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) && !full.endsWith(path.join('lib', 'sources', 'reader-groups.ts'))) {
        if (fs.readFileSync(full, 'utf8').includes('setGroupManifestForTests')) offenders.push(path.relative(SRC, full));
      }
    }
  };
  walk(SRC);
  assert.deepEqual(offenders, []);
});
