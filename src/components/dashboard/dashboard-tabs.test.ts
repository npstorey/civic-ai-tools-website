// UX-2 P4a criteria 1-5, on the component: "My analyses" onto the primitives.
//
//   1. The tab bar is P8 `Tabs`: `role="tablist"` with `ui-tabs` (which
//      globals.css wraps), five `role="tab"` buttons with `aria-selected`;
//      the second reads X19, "My reviews and checks (N)"; the analyses tab
//      counts the total over pages, not the page's rows.
//   2. Each analysis is a P7 `Row`: the summary, the model's display name in
//      the meta line, a lifecycle signal in X20's forms ("Sealed · only you",
//      "Public", "Withdrawn on <date>"), the reviews signal from P5's
//      `reviewsLine`, and an `icon` row menu holding X21's actions as the
//      row's state allows. A sealed, a public, a withdrawn, a reinstated and a
//      seal-only record each have a different menu; a record with an expert
//      review rated "concerns" sits beside one with none, so a reviews line
//      read from the wrong record, or from the count, reads wrong.
//   3. The four dialogs (publish, withdraw, reinstate, revoke token) are P4
//      `Dialog size="short"`: `role="dialog"`, `aria-labelledby` its title, a
//      `[data-part="footer"]` sibling of the body carrying the action. The
//      not-reversible and withdraw sentences render byte for byte. Focus on
//      open, the Tab trap, Escape and focus return are browser reads
//      (criterion 7's instrument and the owner's step), not read here.
//   4. The pager: with more than one page, links carry `?page=`; with one
//      page, none does. (The page's 25/25/10 split, newest first, is
//      `dashboard-page.test.ts`.)
//   5. The evaluations row type declares no `storageKey` (#565 item 1).
//
// THE RULINGS AT THE RED (relay 46), each pinned here: R3 (the disabled
// Publish item reads "Publish" with today's reason; neither "Publish
// unavailable (…)" renders), R4 ("Dashboard", "Previous" and "Next", "Copied"
// read in the `role="status"` region above the list), R5 (the kind words), R6
// (the trigger's name), R7 (no consistency classification on the row).
//
// WHAT IS DRIVEN. The real `DashboardTabs` on the surface harness. An action
// is chosen as a reader chooses it: the row's menu is opened and the item
// clicked; where the tree has no menu (the base), the row's own button with
// that word is clicked, so criterion 3 reads the dialog either way.
//
// BLIND SPOTS, stated. The harness has no layout, focus or browser events
// (`surface-test-harness.ts:25-30`): wrapping, the trailing column's cap and
// the footer in view are criterion 7's instrument. A Menu's panel renders
// only while open, so a menu's items are read after its trigger is clicked.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ComponentType } from 'react';
import ts from 'typescript';
import {
  CONSENT_SURFACE_STUBS,
  SRC,
  h,
  installFetch,
  mount,
  registerSurfaceHooks,
  sessions,
  type HostElement,
  type Surface,
} from '../sources/surface-test-harness.ts';
import { attr, byClass, byRole, childrenOf, classesOf, cssRules, readText, within } from '../ui/ui-test-helpers.ts';

registerSurfaceHooks({ ...CONSENT_SURFACE_STUBS });

const ORIGIN = 'https://app.fixture.example';
const target = { addEventListener() {}, removeEventListener() {} };
Object.assign(globalThis as Record<string, unknown>, {
  window: {
    ...target,
    location: { href: `${ORIGIN}/dashboard`, origin: ORIGIN, pathname: '/dashboard' },
    setTimeout,
    clearTimeout,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  },
  document: { ...target },
});
/** What Copy link wrote, in order. */
const clipboard: string[] = [];
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { clipboard: { writeText: async (text: string) => { clipboard.push(text); } } },
});

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const DashboardTabs = (await load('components/dashboard/DashboardTabs.tsx')).default as ComponentType<Record<string, unknown>>;
const { SEAL_ONLY_UI_REASON } = await load('lib/evidence/seal-only.ts');

function signedIn(): void {
  sessions.server = { user: { id: 'gh-fixture-account', dbId: '99999999-9999-4999-8999-999999999999' } };
  sessions.client = { status: 'authenticated', data: { user: { name: 'Fixture Reader' } } };
}

// --- Fixtures ----------------------------------------------------------------------------

const MODEL = 'anthropic/claude-sonnet-5.5';
/** The catalog's display name for MODEL (`model-catalog.ts`); the raw id is what the base row shows. */
const MODEL_NAME = 'Claude Sonnet 5.5';

const NO_REVIEWS = { expertRatings: [], evaluations: 0, consistencyTests: 0 };

function analysis(slug: string, over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: `id-${slug}`, slug, title: `Fixture ${slug} analysis`, summary: `The ${slug} fixture's summary.`, model: MODEL,
    verificationStatus: 'unverified', consistencyClassification: null, withdrawnAt: null, reinstatedAt: null,
    createdAt: '2026-11-01T12:00:00.000Z', attestationCount: 0, visibility: 'public', reviews: NO_REVIEWS,
    ...over,
  };
}

const SEALED = analysis('sealed', { visibility: 'sealed', createdAt: '2026-11-05T12:00:00.000Z' });
const PUBLIC_CONCERNS = analysis('public-concerns', {
  createdAt: '2026-11-04T12:00:00.000Z', attestationCount: 2,
  reviews: { expertRatings: ['concerns'], evaluations: 1, consistencyTests: 0 },
});
// It carries a consistency classification, which R7 takes off the row.
const PUBLIC_NONE = analysis('public-none', { createdAt: '2026-11-03T12:00:00.000Z', consistencyClassification: 'highly_reproducible' });
const WITHDRAWN = analysis('withdrawn', { createdAt: '2026-11-01T12:00:00.000Z', withdrawnAt: '2026-11-02T12:00:00.000Z' });
const REINSTATED = analysis('reinstated', {
  createdAt: '2026-10-30T12:00:00.000Z', withdrawnAt: '2026-10-31T12:00:00.000Z', reinstatedAt: '2026-11-03T12:00:00.000Z',
});

const EVALUATIONS = [
  { id: 'ev-1', type: 'evaluation', storageKey: 'https://blob.fixture.example/ev-1.json', createdAt: '2026-11-04T12:00:00.000Z', evidenceTitle: 'Another analysis', evidenceSlug: 'another' },
  { id: 'ev-2', type: 'consistency', storageKey: 'https://blob.fixture.example/ev-2.json', createdAt: '2026-11-03T12:00:00.000Z', evidenceTitle: 'A third analysis', evidenceSlug: 'third' },
];
const ACTIVITY = [
  { id: 'ac-1', type: 'expert_attestation', createdAt: '2026-11-04T12:00:00.000Z', evidenceTitle: 'Fixture public-concerns analysis', evidenceSlug: 'public-concerns', creatorDisplayName: 'Fixture reviewer', creatorGithubUrl: 'https://example.invalid/fixture' },
];
const TOKENS = [
  { id: 'tok-1', name: 'Fixture client', tokenPrefix: 'cat_fix', scope: 'publish', createdAt: '2026-11-01T12:00:00.000Z', expiresAt: '2099-01-01T12:00:00.000Z', lastUsedAt: null },
];

function props(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    myEvidence: [SEALED, PUBLIC_CONCERNS, PUBLIC_NONE, WITHDRAWN, REINSTATED],
    analysesTotal: 60, page: 1, pageCount: 3,
    myEvaluations: EVALUATIONS, activity: ACTIVITY, tokens: TOKENS,
    signingConfigured: true, sealOnly: false,
    ...over,
  };
}

async function dashboard(over: Record<string, unknown> = {}): Promise<Surface> {
  signedIn();
  installFetch(ORIGIN, {});
  return mount(h(DashboardTabs, props(over)));
}

// --- Readers -----------------------------------------------------------------------------

const labelsIn = (el: HostElement, cls: string): string[] => within(el).filter((e) => classesOf(e).includes(cls)).map((e) => readText(e));

/** The one P7 row whose title reads `title`; an assertion failure naming what the surface holds otherwise. */
function rowTitled(surface: Surface, title: string): HostElement {
  const rows = byClass(surface, 'ui-row').filter((row) => labelsIn(row, 'ui-row-title').includes(title));
  assert.equal(rows.length, 1, `premise: one P7 row titled ${JSON.stringify(title)}, found ${rows.length}; the surface reads: ${surface.text().slice(0, 300)}`);
  return rows[0];
}

const menuTriggerIn = (el: HostElement): HostElement[] => within(el).filter((e) => e.type === 'button' && attr(e, 'aria-haspopup') === 'menu');

interface ItemRead { label: string; disabled: boolean; reason: string | null; href: string | null }

/** Open the row's menu and read its items; the surface keeps the menu open. */
async function openMenu(surface: Surface, title: string): Promise<ItemRead[]> {
  const triggers = menuTriggerIn(rowTitled(surface, title));
  assert.equal(triggers.length, 1, `the row ${JSON.stringify(title)} has no one menu trigger`);
  assert.ok(classesOf(triggers[0]).includes('ui-menu-trigger--icon'), `the row ${JSON.stringify(title)}'s menu trigger is not an icon trigger`);
  assert.ok((attr(triggers[0], 'aria-label') ?? '') !== '', `the row ${JSON.stringify(title)}'s icon trigger has no accessible name`);
  await surface.click(triggers[0]);
  const panels = within(rowTitled(surface, title)).filter((e) => attr(e, 'role') === 'menu');
  assert.equal(panels.length, 1, `the row ${JSON.stringify(title)}'s menu did not open`);
  return within(panels[0]).filter((e) => attr(e, 'role') === 'menuitem').map((item) => ({
    label: labelsIn(item, 'ui-menu-item-label')[0] ?? readText(item),
    disabled: attr(item, 'aria-disabled') === 'true',
    reason: labelsIn(item, 'ui-menu-item-reason')[0] ?? null,
    href: attr(item, 'href'),
  }));
}

/**
 * Choose `action` on the analysis titled `title`: from the row's menu where
 * the row has one, otherwise the one button with that word (the base's
 * inline actions), so a dialog criterion reads the dialog on either tree.
 */
async function choose(surface: Surface, title: string, action: string): Promise<void> {
  const rows = byClass(surface, 'ui-row').filter((row) => labelsIn(row, 'ui-row-title').includes(title));
  if (rows.length === 1 && menuTriggerIn(rows[0]).length === 1) {
    await surface.click(menuTriggerIn(rows[0])[0]);
    const items = within(rowTitled(surface, title)).filter((e) => attr(e, 'role') === 'menuitem' && labelsIn(e, 'ui-menu-item-label')[0] === action);
    assert.equal(items.length, 1, `premise: the row ${JSON.stringify(title)}'s menu holds one "${action}"`);
    await surface.click(items[0]);
    return;
  }
  await surface.click(surface.button(action));
}

/** The one open dialog, with its parts. */
function theDialog(surface: Surface): { dialog: HostElement; body: HostElement; footer: HostElement } {
  const dialogs = byRole(surface, 'dialog');
  assert.equal(dialogs.length, 1, `expected one role="dialog", found ${dialogs.length}; the surface reads: ${surface.text().slice(0, 300)}`);
  const dialog = dialogs[0];
  const parts = childrenOf(dialog);
  const body = parts.filter((e) => attr(e, 'data-part') === 'body');
  const footer = parts.filter((e) => attr(e, 'data-part') === 'footer');
  assert.equal(body.length, 1, 'the dialog has no body among its own children');
  assert.equal(footer.length, 1, 'the dialog has no [data-part="footer"] sibling of its body');
  return { dialog, body: body[0], footer: footer[0] };
}

/** What the dialog's `aria-labelledby` names, read. */
function labelOf(surface: Surface, dialog: HostElement): string {
  const id = attr(dialog, 'aria-labelledby');
  assert.ok(id, 'the dialog has no aria-labelledby');
  const named = surface.elements().filter((e) => attr(e, 'id') === id);
  assert.equal(named.length, 1, `aria-labelledby="${id}" names ${named.length} elements`);
  return readText(named[0]);
}

const buttonsIn = (el: HostElement): string[] => within(el).filter((e) => e.type === 'button').map((e) => readText(e));

// --- Criterion 1: the tab bar ---------------------------------------------------------------

test('UX-2 P4a C1: the tab bar is a role="tablist" with ui-tabs, five role="tab" with aria-selected, X19\'s word, the analyses total', async () => {
  const s = await dashboard();
  const lists = byRole(s, 'tablist');
  assert.equal(lists.length, 1, `expected one role="tablist", found ${lists.length}`);
  assert.ok(classesOf(lists[0]).includes('ui-tabs'), `the tablist's classes are ${JSON.stringify(classesOf(lists[0]))}`);
  const tabs = within(lists[0]).filter((e) => attr(e, 'role') === 'tab');
  assert.deepEqual(
    tabs.map((t) => readText(t)),
    ['My analyses (60)', 'My reviews and checks (2)', 'Activity (1)', 'Tokens (1)', 'Sources'],
    'the five tabs, in order, with their counts',
  );
  assert.deepEqual(tabs.map((t) => attr(t, 'aria-selected')), ['true', 'false', 'false', 'false', 'false'], 'aria-selected on each tab');
  assert.ok(cssRules('.ui-tabs').some((d) => /flex-wrap:\s*wrap/.test(d)), 'globals.css does not wrap .ui-tabs');
  s.unmount();
});

test('UX-2 P4a C1: selecting a tab moves aria-selected; ?tab=sources still opens the Sources tab', async () => {
  const s = await dashboard();
  const second = byRole(s, 'tab').filter((t) => readText(t).startsWith('My reviews and checks'));
  assert.equal(second.length, 1, 'premise: one "My reviews and checks" tab');
  await s.click(second[0]);
  assert.deepEqual(byRole(s, 'tab').map((t) => attr(t, 'aria-selected')), ['false', 'true', 'false', 'false', 'false']);
  s.unmount();
  const sources = await dashboard({ initialTab: 'sources' });
  assert.deepEqual(byRole(sources, 'tab').map((t) => attr(t, 'aria-selected')), ['false', 'false', 'false', 'false', 'true']);
  sources.unmount();
});

// --- Criterion 2: the rows ------------------------------------------------------------------

/** Each fixture's row as criterion 2 reads it: its lifecycle and reviews signals, a meta item, and its menu. */
const ROWS: Array<{ fixture: Record<string, unknown>; signals: string[]; meta: string[]; menu: string[]; withdrawn: boolean }> = [
  { fixture: SEALED, signals: ['Sealed · only you', 'No reviews yet'], meta: [MODEL_NAME], menu: ['Open', 'Publish', 'Withdraw', 'Copy link'], withdrawn: false },
  { fixture: PUBLIC_CONCERNS, signals: ['Public', '2 reviews: 1 expert review (concerns), 1 evaluation'], meta: [MODEL_NAME], menu: ['Open', 'Withdraw', 'Copy link'], withdrawn: false },
  { fixture: PUBLIC_NONE, signals: ['Public', 'No reviews yet'], meta: [MODEL_NAME], menu: ['Open', 'Withdraw', 'Copy link'], withdrawn: false },
  { fixture: WITHDRAWN, signals: ['Withdrawn on Nov 2, 2026', 'No reviews yet'], meta: [MODEL_NAME], menu: ['Open', 'Reinstate', 'Copy link'], withdrawn: true },
  // Reinstated: the record reads as its state (public) again; "Reinstated <date>" stays today's words, in the meta line (brief measurement 5).
  { fixture: REINSTATED, signals: ['Public', 'No reviews yet'], meta: [MODEL_NAME, 'Reinstated Nov 3, 2026'], menu: ['Open', 'Copy link'], withdrawn: false },
];

for (const want of ROWS) {
  const title = want.fixture.title as string;
  test(`UX-2 P4a C2: the ${want.fixture.slug} row: summary, model display name, X20's lifecycle signal, the reviews line, and its menu`, async () => {
    const s = await dashboard();
    const row = rowTitled(s, title);
    assert.deepEqual(labelsIn(row, 'ui-row-summary'), [want.fixture.summary], 'the row\'s summary');
    const meta = labelsIn(row, 'ui-row-meta-item');
    for (const item of want.meta) assert.ok(meta.includes(item), `the meta line ${JSON.stringify(meta)} has no ${JSON.stringify(item)}`);
    assert.ok(!meta.includes(MODEL), `the meta line shows the raw model id: ${JSON.stringify(meta)}`);
    assert.deepEqual(labelsIn(row, 'ui-signal-label'), want.signals, 'the row\'s signals, lifecycle first');
    assert.equal(classesOf(row).includes('ui-row--withdrawn'), want.withdrawn, 'the row\'s withdrawn state');
    assert.ok(within(row).some((e) => classesOf(e).includes('ui-row-trailing') && within(e).some((m) => classesOf(m).includes('ui-row-menu'))), 'the menu is not in the row\'s trailing column');
    const items = await openMenu(s, title);
    assert.deepEqual(items.map((i) => i.label), want.menu, 'the menu\'s actions');
    assert.deepEqual(items.filter((i) => i.disabled).map((i) => i.label), [], 'an action is disabled');
    assert.deepEqual(items.find((i) => i.label === 'Open')?.href, `/records/${want.fixture.slug}`, 'Open does not link the analysis');
    s.unmount();
  });
}

test('UX-2 P4a C2: on a seal-only instance, a sealed row\'s Publish is disabled with its reason', async () => {
  const s = await dashboard({ myEvidence: [SEALED], analysesTotal: 1, pageCount: 1, sealOnly: true });
  const row = rowTitled(s, SEALED.title as string);
  assert.deepEqual(labelsIn(row, 'ui-signal-label'), ['Sealed · only you', 'No reviews yet']);
  const items = await openMenu(s, SEALED.title as string);
  assert.deepEqual(items.map((i) => i.label), ['Open', 'Publish', 'Withdraw', 'Copy link'], 'the seal-only menu\'s actions');
  const publish = items.find((i) => i.label === 'Publish')!;
  assert.equal(publish.disabled, true, 'Publish is not disabled on a seal-only instance');
  assert.equal(publish.reason, SEAL_ONLY_UI_REASON, 'Publish does not carry the seal-only reason');
  s.unmount();
});

test('UX-2 P4a C2: the five fixtures\' menus are five different menus', async () => {
  const menus: string[] = [];
  for (const [fixture, over] of [
    [SEALED, {}], [PUBLIC_NONE, {}], [WITHDRAWN, {}], [REINSTATED, {}], [SEALED, { sealOnly: true }],
  ] as Array<[Record<string, unknown>, Record<string, unknown>]>) {
    const s = await dashboard({ myEvidence: [fixture], analysesTotal: 1, pageCount: 1, ...over });
    const items = await openMenu(s, fixture.title as string);
    menus.push(JSON.stringify(items.map((i) => [i.label, i.disabled])));
    s.unmount();
  }
  assert.equal(new Set(menus).size, 5, `the menus: ${menus.join(' | ')}`);
});

test('UX-2 P4a C2: the Evaluations and Activity lists are P7 rows, their kind a P6 signal', async () => {
  const s = await dashboard();
  await s.click(byRole(s, 'tab').filter((t) => readText(t).startsWith('My reviews and checks'))[0] ?? s.button('My Evaluations (2)'));
  for (const e of EVALUATIONS) {
    const row = rowTitled(s, e.evidenceTitle);
    assert.equal(labelsIn(row, 'ui-signal-label').length, 1, `the ${e.id} row carries no one kind signal`);
  }
  await s.click(byRole(s, 'tab').filter((t) => readText(t).startsWith('Activity'))[0] ?? s.button('Activity (1)'));
  const row = rowTitled(s, ACTIVITY[0].evidenceTitle);
  assert.equal(labelsIn(row, 'ui-signal-label').length, 1, 'the activity row carries no one kind signal');
  s.unmount();
});

// --- Criterion 3: the four dialogs ------------------------------------------------------------

/** The not-reversible sentence (PW2 S8, G0-4 B), for the sealed fixture's title. */
const NOT_REVERSIBLE =
  `Publishing makes the content of ${SEALED.title} publicly accessible, lists it in the registry, and emits ` +
  'signed publication attestations. Publication is not reversible — a later withdrawal flags the analysis but does ' +
  'not erase it.';
const WITHDRAW_SENTENCE =
  'Withdrawing an analysis is a public, permanent action. The analysis and its cryptographic proofs remain ' +
  'accessible, but it will be flagged as withdrawn.';

const DIALOGS: Array<{ name: string; over: Record<string, unknown>; open: (s: Surface) => Promise<void>; title: string; action: string; body: (body: HostElement) => void }> = [
  {
    name: 'publish', over: { myEvidence: [SEALED] }, title: 'Publish this analysis', action: 'Publish',
    open: (s) => choose(s, SEALED.title as string, 'Publish'),
    body: (body) => {
      assert.deepEqual(within(body).filter((e) => e.type === 'p' && readText(e).startsWith('Publishing makes')).map((e) => readText(e)), [NOT_REVERSIBLE], 'the not-reversible sentence');
      assert.equal(within(body).filter((e) => e.type === 'input' && e.props.type === 'checkbox').length, 1, 'the evaluation checkbox is not in the body');
    },
  },
  {
    name: 'withdraw', over: { myEvidence: [PUBLIC_NONE] }, title: 'Withdraw this analysis', action: 'Withdraw',
    open: (s) => choose(s, PUBLIC_NONE.title as string, 'Withdraw'),
    body: (body) => {
      assert.deepEqual(within(body).filter((e) => e.type === 'p' && readText(e).startsWith('Withdrawing')).map((e) => readText(e)), [WITHDRAW_SENTENCE], 'the withdraw sentence');
      assert.equal(within(body).filter((e) => e.type === 'textarea').length, 1, 'the reason field is not in the body');
    },
  },
  {
    name: 'reinstate', over: { myEvidence: [WITHDRAWN] }, title: 'Reinstate this analysis', action: 'Reinstate',
    open: (s) => choose(s, WITHDRAWN.title as string, 'Reinstate'),
    body: (body) => assert.equal(within(body).filter((e) => e.type === 'textarea').length, 1, 'the reason field is not in the body'),
  },
  {
    name: 'revoke token', over: { initialTab: 'tokens' }, title: 'Revoke token', action: 'Revoke',
    open: (s) => s.click(s.button('Revoke')),
    body: (body) => assert.ok(readText(body).includes('Revoking is immediate and permanent.'), 'the revoke sentence is not in the body'),
  },
];

for (const d of DIALOGS) {
  test(`UX-2 P4a C3: the ${d.name} dialog is a short P4 Dialog: role="dialog", aria-labelledby its title, the action in a footer beside the body`, async () => {
    const s = await dashboard(d.over);
    assert.equal(byRole(s, 'dialog').length, 0, 'premise: no dialog before the action');
    await d.open(s);
    const { dialog, body, footer } = theDialog(s);
    assert.equal(labelOf(s, dialog), d.title, 'the dialog\'s accessible name');
    assert.ok(classesOf(dialog).includes('ui-dialog--short'), `the dialog's classes are ${JSON.stringify(classesOf(dialog))}`);
    assert.ok(buttonsIn(footer).includes(d.action), `the footer's buttons are ${JSON.stringify(buttonsIn(footer))}`);
    assert.ok(buttonsIn(footer).includes('Cancel'), 'the footer carries no Cancel');
    assert.ok(!buttonsIn(body).includes(d.action), 'the action is still inside the body');
    d.body(body);
    s.unmount();
  });
}

// --- Criterion 4: the pager ------------------------------------------------------------------

const pageLinks = (s: Surface): string[] =>
  s.elements().filter((e) => e.type === 'a' && typeof e.props.href === 'string' && /[?&]page=/.test(e.props.href)).map((e) => e.props.href as string);

test('UX-2 P4a C4: with more than one page, the pager links each page through ?page=', async () => {
  const s = await dashboard({ page: 2, pageCount: 3 });
  const links = pageLinks(s);
  for (const n of [1, 3]) assert.ok(links.includes(`/dashboard?page=${n}`), `no link to page ${n}: ${JSON.stringify(links)}`);
  assert.ok(links.every((href) => /^\/dashboard\?page=[1-3]$/.test(href)), `a pager link leaves the dashboard's pages: ${JSON.stringify(links)}`);
  s.unmount();
});

test('UX-2 P4a C4: with one page, no link carries ?page=', async () => {
  const s = await dashboard({ myEvidence: [PUBLIC_NONE], analysesTotal: 1, page: 1, pageCount: 1 });
  assert.deepEqual(pageLinks(s), []);
  s.unmount();
});

// --- Criterion 5: no storageKey in the evaluations row type ---------------------------------------

test('UX-2 P4a C5: the evaluations row type declares no storageKey (#565 item 1)', () => {
  const dir = path.join(SRC, 'components', 'dashboard');
  const found: Array<{ file: string; members: string[] }> = [];
  for (const name of fs.readdirSync(dir)) {
    if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) continue;
    const file = path.join(dir, name);
    const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, name.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    for (const st of sf.statements) {
      if (ts.isInterfaceDeclaration(st) && st.name.text === 'EvaluationRow') {
        found.push({ file: name, members: st.members.map((m) => (m.name && ts.isIdentifier(m.name) ? m.name.text : '?')) });
      }
      if (ts.isTypeAliasDeclaration(st) && st.name.text === 'EvaluationRow' && ts.isTypeLiteralNode(st.type)) {
        found.push({ file: name, members: st.type.members.map((m) => (m.name && ts.isIdentifier(m.name) ? m.name.text : '?')) });
      }
    }
  }
  assert.equal(found.length, 1, `premise: one EvaluationRow type under src/components/dashboard, found ${JSON.stringify(found)}`);
  assert.ok(!found[0].members.includes('storageKey'), `${found[0].file}'s EvaluationRow declares ${JSON.stringify(found[0].members)}`);
});

// --- The rulings at the red (relay 46) ------------------------------------------------------------

/** The unsigned tier's reason, today's words (`DashboardTabs.tsx:369` at the base). */
const UNSIGNED_REASON =
  'Publishing is unavailable — this instance is running unsigned (signing is not configured). Signing is the ' +
  'go-to-production step and takes both PUBLISHER_SIGNING_KEY and PUBLISHER_KEY_ID; see docs/instance-setup.md.';

test('UX-2 P4a R3: on an unsigned instance, Publish reads "Publish", disabled, with the unsigned reason', async () => {
  const s = await dashboard({ myEvidence: [SEALED], analysesTotal: 1, pageCount: 1, signingConfigured: false });
  const items = await openMenu(s, SEALED.title as string);
  const publish = items.find((i) => i.label === 'Publish');
  assert.ok(publish, `no Publish item: ${JSON.stringify(items)}`);
  assert.equal(publish.disabled, true, 'Publish is not disabled on an unsigned instance');
  assert.equal(publish.reason, UNSIGNED_REASON, 'Publish does not carry the unsigned reason');
  s.unmount();
});

test('UX-2 P4a R3: neither "Publish unavailable (…)" label renders, menu open, on a seal-only or an unsigned instance', async () => {
  for (const over of [{ sealOnly: true }, { signingConfigured: false }]) {
    const s = await dashboard({ myEvidence: [SEALED], analysesTotal: 1, pageCount: 1, ...over });
    assert.ok(!s.text().includes('Publish unavailable'), `menu closed, ${JSON.stringify(over)}: ${s.text().slice(0, 300)}`);
    await openMenu(s, SEALED.title as string);
    assert.ok(!s.text().includes('Publish unavailable'), `menu open, ${JSON.stringify(over)}: ${s.text().slice(0, 300)}`);
    s.unmount();
  }
});

test('UX-2 P4a R4: the tablist is named "Dashboard"', async () => {
  const s = await dashboard();
  assert.deepEqual(byRole(s, 'tablist').map((l) => attr(l, 'aria-label')), ['Dashboard']);
  s.unmount();
});

test('UX-2 P4a R4: the pager reads "Previous" and "Next", each a link where there is a page to go to', async () => {
  const linkWords = (s: Surface) => s.elements().filter((e) => e.type === 'a' && typeof e.props.href === 'string' && /[?&]page=/.test(e.props.href))
    .map((e) => [readText(e), e.props.href as string]);
  const middle = await dashboard({ page: 2, pageCount: 3 });
  const words = linkWords(middle);
  assert.deepEqual(words.filter(([w]) => w === 'Previous' || w === 'Next'), [['Previous', '/dashboard?page=1'], ['Next', '/dashboard?page=3']]);
  middle.unmount();
  const first = await dashboard({ page: 1, pageCount: 3 });
  assert.deepEqual(linkWords(first).filter(([w]) => w === 'Previous' || w === 'Next'), [['Next', '/dashboard?page=2']], 'page 1: only Next is a link');
  assert.ok(first.text().includes('Previous'), 'page 1: "Previous" is not shown');
  first.unmount();
});

test('UX-2 P4a R4: Copy link copies the analysis\'s address and the status region above the list reads "Copied"', async () => {
  clipboard.length = 0;
  const s = await dashboard();
  const status = () => byRole(s, 'status');
  assert.equal(status().length, 1, 'premise: one role="status" region');
  assert.equal(readText(status()[0]), '', 'the status region reads before anything is copied');
  const region = status()[0];
  const list = byClass(s, 'ui-row');
  const all = s.elements();
  assert.ok(all.indexOf(region) < all.indexOf(list[0]), 'the status region is not above the list');
  await choose(s, PUBLIC_NONE.title as string, 'Copy link');
  assert.deepEqual(clipboard, [`${ORIGIN}/records/${PUBLIC_NONE.slug}`], 'what Copy link wrote');
  assert.equal(readText(status()[0]), 'Copied', 'the status region after Copy link');
  assert.equal(attr(status()[0], 'aria-live'), 'polite');
  s.unmount();
});

test('UX-2 P4a R4: "Withdrawn on <date>" uses today\'s formatDate (en-US, short month)', async () => {
  const s = await dashboard();
  assert.equal(labelsIn(rowTitled(s, WITHDRAWN.title as string), 'ui-signal-label')[0], 'Withdrawn on Nov 2, 2026');
  s.unmount();
});

test('UX-2 P4a R5: the kind signal reads "Expert review", "Evaluation" or "Consistency test"', async () => {
  const s = await dashboard();
  const tab = (prefix: string) => {
    const found = byRole(s, 'tab').filter((t) => readText(t).startsWith(prefix));
    assert.equal(found.length, 1, `premise: one tab "${prefix}…"`);
    return found[0];
  };
  await s.click(tab('My reviews and checks'));
  assert.deepEqual(EVALUATIONS.map((e) => labelsIn(rowTitled(s, e.evidenceTitle), 'ui-signal-label')), [['Evaluation'], ['Consistency test']]);
  await s.click(tab('Activity'));
  assert.deepEqual(labelsIn(rowTitled(s, ACTIVITY[0].evidenceTitle), 'ui-signal-label'), ['Expert review']);
  s.unmount();
});

test('UX-2 P4a R6: the row menu\'s icon trigger is named "Actions for " and the row\'s title', async () => {
  const s = await dashboard();
  const triggers = menuTriggerIn(rowTitled(s, SEALED.title as string));
  assert.deepEqual(triggers.map((t) => attr(t, 'aria-label')), ['Actions for Fixture sealed analysis']);
  s.unmount();
});

test('UX-2 P4a R7: a row carries no consistency classification', async () => {
  const s = await dashboard();
  const row = rowTitled(s, PUBLIC_NONE.title as string);
  assert.equal(PUBLIC_NONE.consistencyClassification, 'highly_reproducible', 'premise: the fixture carries one');
  assert.ok(!/reproducib/i.test(readText(row)), `the row reads: ${readText(row)}`);
  s.unmount();
});
