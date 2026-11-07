// UX-2 P2 criteria 1, 2, 3, 8 and 9: the analysis page's reviews, driven on
// the surface harness (`../sources/surface-test-harness.ts`).
//
// WHAT IS MOUNTED. The page's one review store (`RecordReviewsProvider`), with
// the status area's summary row (`ReviewsSummaryRow`) and the "Reviews"
// section's list (`AttestationSection`) as its children, inside the two
// providers the record page's layout mounts (`HostLinksProvider`,
// `SignInOptionsProvider`). The store mounts the one add-review sheet. Every
// request is answered here: the record's review list (GET and POST), each
// review's stored package, the model list, the evaluation and replay routes,
// and the consent and flows routes (their real handlers, as the consent suite
// answers them).
//
// HOW THE ROW AND THE PARTS ARE READ. By `data-part` (the row's
// `reviews-summary`), by role (the sheet's `dialog`), by class (P7's `ui-row`,
// P1's `ui-disclosure`, P5's `ui-card--selectable`, P6's `ui-signal-label`) and
// by readable text; never by child index. The summary row's element is
// rendered in every state, empty while the read has not settled or failed, so
// the record page can place it (`record-page-layout.test.ts`).
//
// WHAT MAKES IT ABLE TO FAIL.
//   - The three-kinds record holds one expert review ("concerns"), one
//     evaluation and one consistency test by three distinct attesters, served
//     newest first, so a line that counts rows, drops a kind or misses the
//     rating word reads differently from `reviewsLine`.
//   - "Before the read settles" holds the list (and then the expert payload)
//     open, so a row that renders a count from a partial read is seen doing so.
//   - A failed read is driven twice, as a 500 and as a network error.
//   - The flow's POST is answered by a stateful double, so the row's count can
//     only move if the store reads the list again.
//
// BLIND SPOTS, stated (the harness's). No layout, focus or browser events:
// Escape, focus return to the trigger that opened the sheet, and the sheet's
// placement are staging and instrument reads (criteria 10 and 11). A
// `<details>` is toggled here by calling its `onToggle` as React would.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
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
import { attr, byPart, byRole, childrenOf, hasClass, parentOf, readText, within } from '../ui/ui-test-helpers.ts';

registerSurfaceHooks({
  ...CONSENT_SURFACE_STUBS,
  'next-auth/react': `
    const S = globalThis.__w3Sessions;
    export function useSession() { return { status: S.client.status, data: S.client.data, update: async () => S.client.data }; }
    export async function signIn(id) { (globalThis.__p2SignIns ??= []).push(id ?? null); }
    export async function signOut() {}
    export function SessionProvider({ children }) { return children; }`,
});

for (const name of [
  'BOSTON_OPENCONTEXT_MCP_URL', 'NYC_CHARTER_HOSTING', 'DATA_COMMONS_MCP_URL', 'MODEL_API_BASE_URL', 'VERCEL_ENV',
  'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID',
  'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST', 'NEXTAUTH_URL', 'SITE_DEPLOYMENT_GUIDE_URL',
]) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.EXECUTOR_DRIVER = 'none';

const ORIGIN = 'https://site.fixture.example';
const SLUG = 'fixture-reviews-record';
const LIST = `/api/records/${SLUG}/attestations`;
const SIGN_IN_HREF = 'https://app.fixture.example/ask?signin=1';

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const { RecordReviewsProvider } = await load('components/evidence/RecordReviewsProvider.tsx');
const ReviewsSummaryRow = (await load('components/evidence/ReviewsSummaryRow.tsx')).default as ComponentType;
const AttestationSection = (await load('components/evidence/AttestationSection.tsx')).default as ComponentType<Record<string, unknown>>;
const { HostLinksProvider } = await load('components/HostLinksProvider.tsx');
const { SignInOptionsProvider } = await load('components/SignInOptionsProvider.tsx');
const { reviewsLine, NO_REVIEWS } = await load('lib/evidence/review-summary.ts');
const { REVIEWS_LOAD_FAILED, REVIEWS_SECTION_ID } = await load('lib/evidence/record-reviews.ts');
const { EXPERT_RATING_LABELS, EXPERT_RATINGS } = await load('lib/evidence/expert-attestation.ts');
const { SIGN_IN_PANEL_HREF } = await load('lib/host-links.ts');
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const { buildFlowsStatement, statementHash } = await load('lib/flows/statement.ts');

// --- The words, as ruled (contract v4, "Words: RULED"; Q2) -------------------------

const W = {
  seeThem: 'See them',
  addOne: 'Add one',
  sheetTitle: 'Add a review', // X18
  publish: 'Publish review', // X15
  expertise: 'Expertise or affiliation (published)', // X16
  automated: 'Run an automated check instead', // X17
  evaluationChoice: 'Evaluation: a second model reviews the answer against a fixed checklist.', // X17
  consistencyChoice: 'Consistency test: re-runs the analysis to see whether it can be reproduced.', // X17
  readTheReview: 'Read the review', // X14
  types: { expert_attestation: 'Expert review', evaluation: 'Evaluation', consistency: 'Consistency test' }, // X13
  loading: 'Loading reviews...', // R3 B
  signedOut: 'Sign in with GitHub to add a review.', // R3 B, with the instance's one provider
  addReview: '+ Add review', // R3 B
  saveFailed: 'Failed to save review', // R3 B
  saveCheck: 'Save review', // R3 B
  loadFailed: 'The reviews could not be loaded. Reloading the page tries again.', // Q2, ruled (relay 25)
  lead: 'A review from a domain expert, published as part of this analysis. Your GitHub identity, self-described expertise, and the review text are all published publicly. Each review shows its own signing status once submitted.',
  droppedLead: 'Attestations are independent evaluations', // Q1: dropped
};

// --- The record's reviews, and the doubles that answer for them ----------------------

interface ListRow {
  id: string;
  type: 'expert_attestation' | 'evaluation' | 'consistency';
  packageHash: string;
  createdAt: string;
  creatorDisplayName: string;
  creatorGithubUrl: string;
  signature: null;
}

const row = (id: string, type: ListRow['type'], createdAt: string, by: string): ListRow => ({
  id, type, packageHash: `${id}-hash`, createdAt, creatorDisplayName: by, creatorGithubUrl: `https://github.com/${by.replace(/\s+/g, '-').toLowerCase()}`, signature: null,
});

const EXPERT_BODY = 'First line of the expert review.\n\nA second paragraph of the expert review.';
const THREE_KINDS: ListRow[] = [
  row('r-consistency', 'consistency', '2026-11-03T09:00:00.000Z', 'Fixture Replayer C'),
  row('r-evaluation', 'evaluation', '2026-11-02T09:00:00.000Z', 'Fixture Evaluator B'),
  row('r-expert', 'expert_attestation', '2026-11-01T09:00:00.000Z', 'Fixture Expert A'),
];
const PACKAGES: Record<string, unknown> = {
  'r-expert': { type: 'expert_attestation', body: EXPERT_BODY, expertise: 'Fixture expertise', rating: 'concerns' },
  'r-evaluation': { type: 'evaluation', evaluatorModel: 'fixture/evaluator', overallScore: 7, assessment: 'Fixture assessment.', rubric: {} },
  'r-consistency': { type: 'consistency', config: { numRuns: 3 }, metrics: { toolCallOverlap: 1, outputSimilarity: 0.9, consistencyClassification: 'highly_reproducible' } },
};
const THREE_KINDS_LINE = '3 reviews: 1 expert review (concerns), 1 evaluation, 1 consistency test';

function deferred(): { promise: Promise<void>; release: () => void } {
  let release = () => {};
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

interface Fixture {
  rows: ListRow[];
  packages?: Record<string, unknown>;
  list?: 'ok' | 'status-500' | 'network';
  listGate?: Promise<void>;
  packageGate?: Promise<void>;
  post?: 'ok' | 'status-500';
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const alerts: unknown[] = [];
(globalThis as unknown as { alert: (m: unknown) => void }).alert = (m) => { alerts.push(m); };

function answer(fx: Fixture) {
  const rows = [...fx.rows];
  const packages: Record<string, unknown> = { ...PACKAGES, ...(fx.packages ?? {}) };
  const posted: Array<Record<string, unknown>> = [];
  const net = installFetch(ORIGIN, {
    '/api/models': () => json({ models: [{ id: 'fixture/evaluator', name: 'Fixture evaluator' }] }),
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent': async (request: Request) => {
      if (request.method === 'GET') {
        const statement = await buildFlowsStatement();
        const states = Object.fromEntries(statement.sources.map((s: { sourceId: string }) => [s.sourceId, { state: 'on', since: '2026-10-19' }]));
        return json({ inForce: true, store: 'cookie', flowsVersion: statementHash(statement), states });
      }
      return (consentRoute[request.method] as (r: Request) => Promise<Response>)(request);
    },
    [`/api/records/${SLUG}/evaluate`]: () => json({
      rubric: Object.fromEntries(['dataSourceIdentification', 'quantitativeClaimSupport', 'confoundersAndBias', 'geographicScope', 'limitationsNoted', 'contradictoryConclusion'].map((k) => [k, { score: 7, comment: 'Fixture.' }])),
      overallScore: 7, assessment: 'Fixture assessment.', evaluatorModel: 'fixture/evaluator',
    }),
    [`/api/records/${SLUG}/replay`]: () => json({ toolCalls: [], output: 'An answer.', tokenUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, durationMs: 1, offeredSet: { from: 'sourcesOffered', sources: ['socrata'], lacking: [] } }),
    [LIST]: async (request: Request) => {
      const rest = new URL(request.url).pathname.slice(LIST.length);
      const pkg = /^\/([^/]+)\/package$/.exec(rest);
      if (pkg !== null) {
        if (fx.packageGate) await fx.packageGate;
        const found = packages[decodeURIComponent(pkg[1])];
        return found === undefined ? json({ error: 'Not found' }, 404) : json(found);
      }
      if (request.method === 'POST') {
        const body = JSON.parse(await request.text()) as Record<string, unknown>;
        posted.push(body);
        if (fx.post === 'status-500') return json({}, 500);
        const id = `r-new-${posted.length}`;
        rows.push(row(id, body.type as ListRow['type'], '2026-11-07T09:00:00.000Z', 'Fixture Reviewer'));
        packages[id] = { type: body.type, ...(body.data as object) };
        return json({ id }, 201);
      }
      if (fx.listGate) await fx.listGate;
      if (fx.list === 'network') throw new TypeError('fetch failed');
      if (fx.list === 'status-500') return json({ error: 'Internal error' }, 500);
      return json({ attestations: rows });
    },
  });
  return { net, posted };
}

interface PageOptions {
  signedIn: boolean;
  signInHref?: string | null;
  providers?: Array<{ id: string; name: string }>;
}

async function page(fx: Fixture, opts: PageOptions): Promise<{ s: Surface; posted: Array<Record<string, unknown>>; sent: () => Array<{ method: string; path: string }> }> {
  alerts.length = 0;
  (globalThis as unknown as { __p2SignIns: unknown[] }).__p2SignIns = [];
  sessions.server = opts.signedIn ? { user: { id: 'fixture-reviewer' } } : null;
  sessions.client = opts.signedIn
    ? { status: 'authenticated', data: { user: { id: 'fixture-reviewer', name: 'Fixture Reviewer' } } }
    : { status: 'unauthenticated', data: null };
  const { net, posted } = answer(fx);
  const props = { slug: SLUG, analysisModel: 'fixture/analysis-model', promptVisibility: 'full_text' };
  const s = await mount(
    h(HostLinksProvider, { value: { marketingOrigin: '', signInHref: opts.signInHref ?? null } },
      h(SignInOptionsProvider, { value: opts.providers ?? [{ id: 'github', name: 'GitHub' }] },
        h(RecordReviewsProvider, props,
          h('div', { 'data-test-slot': 'status-area' }, h(ReviewsSummaryRow)),
          h('div', { 'data-test-slot': 'reviews-section' }, h(AttestationSection, props)),
        ),
      ),
    ),
  );
  return { s, posted, sent: () => net.sent.map(({ method, path: p }) => ({ method, path: p })) };
}

// --- Readers -------------------------------------------------------------------------

const slot = (s: Surface, name: string) => {
  const found = s.elements().filter((el) => attr(el, 'data-test-slot') === name);
  assert.equal(found.length, 1, `the ${name} slot`);
  return found[0];
};

function summaryRow(s: Surface): HostElement {
  const found = byPart(s, 'reviews-summary');
  assert.equal(found.length, 1, `expected one data-part="reviews-summary" (the summary row), found ${found.length}; the surface reads: ${s.text().slice(0, 300)}`);
  return found[0];
}

const sectionText = (s: Surface) => readText(slot(s, 'reviews-section'));

function sheet(s: Surface): HostElement {
  const found = byRole(s, 'dialog');
  assert.equal(found.length, 1, `expected one open sheet (role="dialog"), found ${found.length}; the surface reads: ${s.text().slice(0, 300)}`);
  return found[0];
}

function sheetTitle(s: Surface): string {
  const panel = sheet(s);
  const id = attr(panel, 'aria-labelledby');
  const title = within(panel).find((el) => attr(el, 'id') === id);
  assert.ok(title, 'the sheet is labelled by its title');
  return readText(title);
}

const isPassword = (el: HostElement) => el.type === 'input' && el.props.type === 'password';

function buttonIn(scope: HostElement, label: string): HostElement {
  const found = within(scope).filter((el) => el.type === 'button' && readText(el) === label);
  assert.equal(found.length, 1, `expected one "${label}" button, found ${found.length}; it reads: ${readText(scope).slice(0, 400)}`);
  return found[0];
}

/** "Add one" in the summary row: the element whose text it is (a button or a link). */
function addOne(s: Surface): HostElement {
  const found = within(summaryRow(s)).filter((el) => (el.type === 'button' || el.type === 'a') && readText(el) === W.addOne);
  assert.equal(found.length, 1, `expected one "${W.addOne}" in the summary row, found ${found.length}`);
  return found[0];
}

async function openFromRow(s: Surface): Promise<HostElement> {
  const add = addOne(s);
  assert.equal(add.type, 'button', 'signed in, "Add one" is a button');
  await s.click(add);
  return sheet(s);
}

/** X17: open "Run an automated check instead" (a P1 disclosure, or a control with that text). */
async function chooseAutomated(s: Surface): Promise<void> {
  const panel = sheet(s);
  const summary = within(panel).filter((el) => el.type === 'summary' && readText(el) === W.automated);
  if (summary.length === 1) {
    const details = parentOf(s, summary[0]);
    assert.ok(details && details.type === 'details', 'the X17 summary sits in a <details>');
    const onToggle = details.props.onToggle as ((e: unknown) => void) | undefined;
    assert.equal(typeof onToggle, 'function', 'the X17 disclosure reports its toggle');
    onToggle!({ currentTarget: { open: true }, target: { open: true } });
    await s.settle();
    return;
  }
  await s.click(buttonIn(panel, W.automated));
}

/** One of X17's two choices: a button, or a radio in a label, whose text begins with `term`. */
async function chooseCheck(s: Surface, term: string): Promise<void> {
  const panel = sheet(s);
  const button = within(panel).filter((el) => el.type === 'button' && readText(el).startsWith(term));
  if (button.length === 1) { await s.click(button[0]); return; }
  const label = within(panel).filter((el) => el.type === 'label' && readText(el).startsWith(term));
  assert.equal(label.length, 1, `expected one control for "${term}"; the sheet reads: ${readText(panel).slice(0, 400)}`);
  const radio = within(label[0]).filter((el) => el.type === 'input' && el.props.type === 'radio');
  assert.equal(radio.length, 1, `the "${term}" choice carries one radio`);
  await s.check(radio[0]);
}

/** The rating cards: P5 selectable cards, each carrying one radio. */
function ratingCards(s: Surface): Array<{ card: HostElement; radio: HostElement }> {
  const cards = within(sheet(s)).filter((el) => hasClass(el, 'ui-card--selectable'));
  assert.equal(cards.length, 4, `expected four selectable rating cards, found ${cards.length}`);
  return cards.map((card) => {
    const radios = within(card).filter((el) => el.type === 'input' && el.props.type === 'radio');
    assert.equal(radios.length, 1, `each rating card carries one radio; "${readText(card)}" carries ${radios.length}`);
    return { card, radio: radios[0] };
  });
}

function fieldNamed(s: Surface, label: string): HostElement {
  const panel = sheet(s);
  const labels = within(panel).filter((el) => el.type === 'label' && readText(el) === label);
  assert.equal(labels.length, 1, `expected one label "${label}"`);
  const forId = attr(labels[0], 'for');
  const field = forId !== null
    ? within(panel).find((el) => attr(el, 'id') === forId)
    : within(labels[0]).find((el) => el.type === 'input' || el.type === 'textarea');
  assert.ok(field, `the "${label}" label names its field`);
  return field;
}

function bodyField(s: Surface): HostElement {
  const found = within(sheet(s)).filter((el) => el.type === 'textarea');
  assert.equal(found.length, 1, 'the review path has one body field');
  return found[0];
}

const LITERAL_COLOUR = /style="[^"]*(#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d)/;

// --- Criterion 1: the summary row ---------------------------------------------------

test('UX-2 P2 (1) a record with none: the row reads "No reviews yet · Add one" (X12)', async () => {
  const { s } = await page({ rows: [] }, { signedIn: true });
  assert.equal(readText(summaryRow(s)), `${NO_REVIEWS} · ${W.addOne}`);
  assert.equal(readText(summaryRow(s)), 'No reviews yet · Add one', 'byte for byte');
  s.unmount();
});

test('UX-2 P2 (1) one expert review (concerns), one evaluation, one consistency test: the row is reviewsLine, then "See them · Add one"', async () => {
  const { s } = await page({ rows: THREE_KINDS }, { signedIn: true });
  const line = reviewsLine({ expertRatings: ['concerns'], evaluations: 1, consistencyTests: 1 });
  assert.equal(line, THREE_KINDS_LINE, 'premise: reviewsLine reads the ruled X5 line for this record');
  assert.equal(readText(summaryRow(s)), `${line} · ${W.seeThem} · ${W.addOne}`);
  s.unmount();
});

test('UX-2 P2 (1) "See them" is an in-page link to the "Reviews" section\'s id', async () => {
  const { s } = await page({ rows: THREE_KINDS }, { signedIn: true });
  const links = within(summaryRow(s)).filter((el) => el.type === 'a' && readText(el) === W.seeThem);
  assert.equal(links.length, 1, 'one "See them" link');
  assert.equal(REVIEWS_SECTION_ID, 'reviews', 'premise: the section id');
  assert.equal(attr(links[0], 'href'), `#${REVIEWS_SECTION_ID}`);
  s.unmount();
});

test('UX-2 P2 (1) before the list and every expert payload have settled, the row states no count and no "No reviews yet"', async () => {
  const list = deferred();
  const pkg = deferred();
  const { s } = await page({ rows: THREE_KINDS, listGate: list.promise, packageGate: pkg.promise }, { signedIn: true });
  const before = readText(summaryRow(s));
  assert.doesNotMatch(before, /\d/, `no count while the list is unread: "${before}"`);
  assert.ok(!before.includes(NO_REVIEWS), 'no "No reviews yet" while the list is unread');
  assert.ok(sectionText(s).includes(W.loading), `the list says "${W.loading}" while it is unread`);
  list.release();
  await s.settle();
  const partial = readText(summaryRow(s));
  assert.doesNotMatch(partial, /\d/, `no count while the expert payload is unread: "${partial}"`);
  assert.ok(!partial.includes(NO_REVIEWS), 'no "No reviews yet" while the expert payload is unread');
  pkg.release();
  await s.settle();
  assert.equal(readText(summaryRow(s)), `${THREE_KINDS_LINE} · ${W.seeThem} · ${W.addOne}`, 'once settled, the line');
  s.unmount();
});

for (const failure of ['status-500', 'network'] as const) {
  test(`UX-2 P2 (1, 8) a failed read (${failure}): the row says nothing; the list says Q2's line, never its empty state`, async () => {
    const { s } = await page({ rows: [], list: failure }, { signedIn: true });
    const text = readText(summaryRow(s));
    assert.doesNotMatch(text, /\d/, `no count: "${text}"`);
    assert.ok(!text.includes(NO_REVIEWS), `no "No reviews yet" in the row: "${text}"`);
    const list = sectionText(s);
    assert.ok(list.includes(W.loadFailed), `the list reads Q2's line, byte for byte: "${list}"`);
    assert.equal(REVIEWS_LOAD_FAILED, W.loadFailed, 'one constant carries it');
    assert.ok(!list.includes(NO_REVIEWS), 'the list does not claim there are no reviews');
    assert.ok(!list.includes(W.loading), 'the list has stopped loading');
    s.unmount();
  });
}

test('UX-2 P2 (1) signed out, with the app host\'s sign-in address set: "Add one" is a link to it', async () => {
  const { s } = await page({ rows: [] }, { signedIn: false, signInHref: SIGN_IN_HREF });
  const add = addOne(s);
  assert.equal(add.type, 'a');
  assert.equal(attr(add, 'href'), SIGN_IN_HREF);
  s.unmount();
});

test('UX-2 P2 (1) signed out, one provider, no sign-in address: "Add one" starts that provider\'s sign-in in place and opens no sheet', async () => {
  const { s } = await page({ rows: [] }, { signedIn: false });
  const add = addOne(s);
  assert.equal(add.type, 'button');
  await s.click(add);
  assert.deepEqual((globalThis as unknown as { __p2SignIns: unknown[] }).__p2SignIns, ['github']);
  assert.equal(byRole(s, 'dialog').length, 0, 'no sheet for a reader who is not signed in');
  s.unmount();
});

test('UX-2 P2 (1) signed out, several providers, no sign-in address: "Add one" links to the sign-in panel', async () => {
  const { s } = await page({ rows: [] }, { signedIn: false, providers: [{ id: 'github', name: 'GitHub' }, { id: 'oidc', name: 'Fixture SSO' }] });
  const add = addOne(s);
  assert.equal(add.type, 'a');
  assert.equal(attr(add, 'href'), SIGN_IN_PANEL_HREF);
  s.unmount();
});

test('UX-2 P2 (1) signed out with no sign-in provider: the row offers no "Add one"', async () => {
  const { s } = await page({ rows: [] }, { signedIn: false, providers: [] });
  assert.equal(readText(summaryRow(s)), NO_REVIEWS);
  s.unmount();
});

test('UX-2 P2 (1) signed in: "Add one" and "+ Add review" open the same one sheet, and both stay mounted while it is open', async () => {
  const { s } = await page({ rows: [] }, { signedIn: true });
  await openFromRow(s);
  assert.equal(sheetTitle(s), W.sheetTitle);
  addOne(s);
  buttonIn(slot(s, 'reviews-section'), W.addReview);
  await s.click(buttonIn(sheet(s), 'Close'));
  assert.equal(byRole(s, 'dialog').length, 0, 'closed');
  await s.click(buttonIn(slot(s, 'reviews-section'), W.addReview));
  assert.equal(byRole(s, 'dialog').length, 1, 'the section\'s trigger opens one sheet');
  assert.equal(sheetTitle(s), W.sheetTitle);
  s.unmount();
});

// --- Criterion 2: the sheet opens on the review path ------------------------------------

test('UX-2 P2 (2) the sheet opens on the review path with no key field; the key field appears only after X17 is chosen', async () => {
  const { s } = await page({ rows: [] }, { signedIn: true });
  const panel = await openFromRow(s);
  assert.equal(within(panel).filter(isPassword).length, 0, 'no input[type=password] on open');
  assert.ok(renderToStaticMarkup(panel).includes('<textarea'), 'the review path\'s body field is open');
  assert.doesNotMatch(renderToStaticMarkup(panel), /type="password"/, 'not in the markup either');
  await chooseAutomated(s);
  assert.equal(within(sheet(s)).filter(isPassword).length, 1, 'the key field, after X17 is chosen');
  s.unmount();
});

// --- Criterion 3: each review is a P7 row ------------------------------------------------

test('UX-2 P2 (3) each review is a P7 row: the type as a P6 signal, the attester, the body in a closed "Read the review" disclosure, no pill with a literal colour', async () => {
  const { s } = await page({ rows: THREE_KINDS }, { signedIn: false });
  const rows = within(slot(s, 'reviews-section')).filter((el) => hasClass(el, 'ui-row'));
  assert.equal(rows.length, 3, `three review rows (P7 ui-row), found ${rows.length}`);
  for (const r of THREE_KINDS) {
    const mine = rows.filter((el) => readText(el).includes(r.creatorDisplayName));
    assert.equal(mine.length, 1, `one row for ${r.creatorDisplayName}`);
    const el = mine[0];
    const labels = within(el).filter((x) => hasClass(x, 'ui-signal-label')).map(readText);
    assert.ok(labels.includes(W.types[r.type]), `${r.type}: the type is a P6 signal reading "${W.types[r.type]}" (signals: ${labels.join(' | ')})`);
    const details = within(el).filter((x) => x.type === 'details' && hasClass(x, 'ui-disclosure'));
    assert.equal(details.length, 1, `${r.type}: one P1 disclosure`);
    assert.equal(attr(details[0], 'open'), null, `${r.type}: closed`);
    const summary = childrenOf(details[0]).find((x) => x.type === 'summary');
    assert.equal(summary ? readText(summary) : null, W.readTheReview, `${r.type}: labelled X14`);
    assert.doesNotMatch(renderToStaticMarkup(el), LITERAL_COLOUR, `${r.type}: no inline literal colour in the row`);
  }
  const expert = rows.find((el) => readText(el).includes('Fixture Expert A'))!;
  const rowSummary = within(expert).filter((x) => hasClass(x, 'ui-row-summary'));
  assert.equal(rowSummary.length === 1 ? readText(rowSummary[0]) : null, 'First line of the expert review.', 'the body\'s first line is the row\'s summary');
  const body = within(expert).find((x) => x.type === 'details')!;
  assert.ok(readText(body).includes('A second paragraph of the expert review.'), 'the body sits inside the disclosure');
  assert.ok(readText(expert).includes(EXPERT_RATING_LABELS.concerns), 'the rating word, as the page labels it');
  const markup = renderToStaticMarkup(slot(s, 'reviews-section'));
  for (const gone of ['#8a5a00', '#53319c', 'Show details', 'Hide details']) assert.ok(!markup.includes(gone), `"${gone}" is gone`);
  s.unmount();
});

// --- Criterion 8: the words, byte for byte -------------------------------------------------

test('UX-2 P2 (8) the list: the empty state is NO_REVIEWS alone, the loading and signed-out lines are R3 B\'s', async () => {
  const empty = await page({ rows: [] }, { signedIn: false });
  const text = sectionText(empty.s);
  assert.ok(text.includes(NO_REVIEWS), `the empty state: "${text}"`);
  assert.ok(!text.includes(W.droppedLead), 'Q1: the second sentence is dropped');
  assert.ok(text.includes(W.signedOut), `the signed-out line, byte for byte: "${text}"`);
  assert.doesNotMatch(text, /attestation/i, 'no reader-facing "attestation" in the list');
  empty.s.unmount();
  const gate = deferred();
  const loading = await page({ rows: [], listGate: gate.promise }, { signedIn: true });
  assert.ok(sectionText(loading.s).includes(W.loading), `"${W.loading}" while the list is read`);
  gate.release();
  await loading.s.settle();
  loading.s.unmount();
});

test('UX-2 P2 (8) the rows: X13\'s types and X14\'s "Read the review" on all three kinds', async () => {
  const { s } = await page({ rows: THREE_KINDS }, { signedIn: true });
  const rows = within(slot(s, 'reviews-section')).filter((el) => hasClass(el, 'ui-row'));
  const labels = rows.flatMap((el) => within(el).filter((x) => hasClass(x, 'ui-signal-label')).map(readText));
  for (const word of Object.values(W.types)) assert.ok(labels.includes(word), `the type "${word}" (found: ${labels.join(' | ')})`);
  const summaries = rows.flatMap((el) => within(el).filter((x) => x.type === 'summary').map(readText));
  assert.deepEqual(summaries, [W.readTheReview, W.readTheReview, W.readTheReview], 'every row\'s disclosure reads X14');
  assert.ok(buttonIn(slot(s, 'reviews-section'), W.addReview), 'the section\'s trigger reads "+ Add review"');
  s.unmount();
});

test('UX-2 P2 (8) the sheet: X18, X16, X15, the lead verbatim, the rating cards in EXPERT_RATING_LABELS\'s words, and X17 with its two choices', async () => {
  const { s } = await page({ rows: [] }, { signedIn: true });
  const panel = await openFromRow(s);
  assert.equal(sheetTitle(s), W.sheetTitle);
  const text = readText(panel);
  assert.ok(text.includes(W.lead), 'the lead, verbatim');
  fieldNamed(s, W.expertise);
  buttonIn(panel, W.publish);
  const cardWords = ratingCards(s).map(({ card }) => readText(card));
  EXPERT_RATINGS.forEach((rating: string, i: number) => {
    assert.ok(cardWords[i].startsWith(EXPERT_RATING_LABELS[rating]), `card ${i + 1} leads with "${EXPERT_RATING_LABELS[rating]}", the page's word for ${rating}: "${cardWords[i]}"`);
  });
  const summary = within(panel).filter((el) => el.type === 'summary' && readText(el) === W.automated);
  const control = within(panel).filter((el) => el.type === 'button' && readText(el) === W.automated);
  assert.equal(summary.length + control.length, 1, `X17's label "${W.automated}", once`);
  await chooseAutomated(s);
  const opened = readText(sheet(s));
  assert.ok(opened.includes(W.evaluationChoice), `X17's evaluation choice: "${opened.slice(0, 500)}"`);
  assert.ok(opened.includes(W.consistencyChoice), 'X17\'s consistency choice');
  assert.doesNotMatch(readText(sheet(s)), /attestation/i, 'no reader-facing "attestation" in the sheet');
  s.unmount();
});

test('UX-2 P2 (8, 9) the evaluation path: "Save review", and a failed save is the sheet\'s error line "Failed to save review", with no alert()', async () => {
  const { s, posted } = await page({ rows: [], post: 'status-500' }, { signedIn: true });
  await openFromRow(s);
  await chooseAutomated(s);
  await chooseCheck(s, 'Evaluation:');
  await s.type(within(sheet(s)).find(isPassword)!, 'placeholder-evaluator-key');
  const select = within(sheet(s)).filter((el) => el.type === 'select');
  assert.equal(select.length, 1, 'the evaluator model list');
  await s.type(select[0], 'fixture/evaluator');
  await s.click(buttonIn(sheet(s), 'Run Evaluation'));
  await s.click(buttonIn(sheet(s), W.saveCheck));
  assert.equal(posted.length, 1, 'one save was sent');
  assert.ok(readText(sheet(s)).includes(W.saveFailed), `the sheet's error line: "${readText(sheet(s)).slice(-300)}"`);
  assert.deepEqual(alerts, [], 'no alert()');
  s.unmount();
});

test('UX-2 P2 (8) the consistency path: "Save review" once the runs are done', async () => {
  const { s } = await page({ rows: [] }, { signedIn: true });
  await openFromRow(s);
  await chooseAutomated(s);
  await chooseCheck(s, 'Consistency test:');
  await s.type(within(sheet(s)).find(isPassword)!, 'placeholder-replayer-key');
  await s.click(buttonIn(sheet(s), 'Run Consistency Test'));
  buttonIn(sheet(s), W.saveCheck);
  s.unmount();
});

// --- Criterion 9: the flow, through the shared store and a stubbed POST ------------------------

test('UX-2 P2 (9) "Publish review" closes the sheet, adds the row, and moves the row\'s count by one', async () => {
  const { s, posted } = await page({ rows: [] }, { signedIn: true });
  assert.equal(readText(summaryRow(s)), 'No reviews yet · Add one', 'premise: none');
  await openFromRow(s);
  const concerns = ratingCards(s)[EXPERT_RATINGS.indexOf('concerns')];
  await s.check(concerns.radio);
  await s.type(bodyField(s), 'A fixture review body.');
  await s.type(fieldNamed(s, W.expertise), 'Fixture expertise');
  await s.click(buttonIn(sheet(s), W.publish));
  assert.equal(posted.length, 1, 'one POST');
  assert.equal(byRole(s, 'dialog').length, 0, 'the sheet closed');
  const rows = within(slot(s, 'reviews-section')).filter((el) => hasClass(el, 'ui-row'));
  assert.equal(rows.length, 1, 'the new row');
  assert.ok(readText(rows[0]).includes('Fixture Reviewer'), 'by its attester');
  assert.equal(readText(summaryRow(s)), `1 review: 1 expert review (concerns) · ${W.seeThem} · ${W.addOne}`, 'the count moved by one');
  s.unmount();
});

test('UX-2 P2 (9) the rating cards: one checked at a time, and the checked one is the payload\'s rating', async () => {
  const { s, posted } = await page({ rows: [] }, { signedIn: true });
  await openFromRow(s);
  await s.check(ratingCards(s)[EXPERT_RATINGS.indexOf('endorse')].radio);
  await s.check(ratingCards(s)[EXPERT_RATINGS.indexOf('dispute')].radio);
  const cards = ratingCards(s);
  assert.deepEqual(cards.map(({ radio }) => radio.props.checked === true), EXPERT_RATINGS.map((r: string) => r === 'dispute'), 'one radio checked: the last chosen');
  assert.deepEqual(cards.map(({ card }) => hasClass(card, 'ui-card--selected')), EXPERT_RATINGS.map((r: string) => r === 'dispute'), 'one card selected');
  await s.type(bodyField(s), 'A fixture review body.');
  await s.type(fieldNamed(s, W.expertise), 'Fixture expertise');
  await s.click(buttonIn(sheet(s), W.publish));
  assert.equal(posted.length, 1, 'one POST');
  assert.equal((posted[0].data as Record<string, unknown>).rating, 'dispute', 'the payload carries the checked rating');
  assert.equal(posted[0].type, 'expert_attestation', 'premise: the payload\'s type is unchanged (criterion 6)');
  s.unmount();
});

test('UX-2 P2 (9) the review path: a failed save keeps the sheet open with its error line, and calls no alert()', async () => {
  const { s, posted } = await page({ rows: [], post: 'status-500' }, { signedIn: true });
  await openFromRow(s);
  await s.check(ratingCards(s)[EXPERT_RATINGS.indexOf('neutral')].radio);
  await s.type(bodyField(s), 'A fixture review body.');
  await s.type(fieldNamed(s, W.expertise), 'Fixture expertise');
  await s.click(buttonIn(sheet(s), W.publish));
  assert.equal(posted.length, 1, 'one POST');
  assert.ok(readText(sheet(s)).includes(W.saveFailed), 'the error line, in the sheet');
  assert.deepEqual(alerts, [], 'no alert()');
  assert.equal(readText(summaryRow(s)), 'No reviews yet · Add one', 'the count did not move');
  s.unmount();
});
