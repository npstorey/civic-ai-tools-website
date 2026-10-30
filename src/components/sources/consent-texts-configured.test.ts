// R6 W3 (#632), the owner's rulings D1, D3 and D4 (all A) and amendment 1's
// correction 5: what the consent texts say, and what renders only where it is
// true.
//
// - D1: the privacy page's "How consent works" says withdrawing stops what is
//   sent from then on and cannot take back a question already sent; the card
//   does not.
// - D3: the operator's statement about the model endpoint (training only)
//   renders on the card's endpoint row and as the privacy page's "The model
//   endpoint" section only when the operator supplies it
//   (`SITE_OPERATOR_STATES_NO_TRAINING`); unset, the row stays as derived and
//   the section is not rendered.
// - D4: the analytics line and the cookie sentence render below Allow and Not
//   now; "The privacy page has the full statement." stays above; the two
//   buttons are equal in size and style.
// - Correction 5: the card's analytics line only with analytics; "on your
//   account" (the card's cookie sentence, both texts' withdrawal sentence)
//   only with a database. Each in both states.
//
// WHAT IS DRIVEN. The real card on the surface harness with the real
// `/api/flows` and consent handlers, and the privacy page's statements as
// `buildPrivacySections` builds them.
//
// WHAT MAKES IT ABLE TO FAIL. At the base there is no card and no copy.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
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
  type Surface,
} from './surface-test-harness.ts';

// `next/script` renders nothing outside Next; the analytics module imports it.
registerSurfaceHooks({ ...CONSENT_SURFACE_STUBS, 'next/script': 'export default function Script() { return null; }' });

const READ = [
  'MODEL_API_BASE_URL', 'VERCEL_ENV', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'NEXT_PUBLIC_ANALYTICS_SERVICE',
  'NEXT_PUBLIC_ANALYTICS_ID', 'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'SOCRATA_MCP_URL', 'DATA_COMMONS_MCP_URL', 'BOSTON_OPENCONTEXT_MCP_URL',
  'NYC_CHARTER_HOSTING', 'APP_HOST', 'NEXTAUTH_URL', 'SITE_DEPLOYMENT_GUIDE_URL', 'SITE_OPERATOR_STATES_NO_TRAINING', 'DATABASE_URL',
  'EXECUTOR_DRIVER',
];

const ORIGIN = 'https://site.fixture.example';

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const facts = await load('lib/privacy-facts.ts');

/** The modules W3 adds, by specifiers typed `string`, so the red commit type-checks. */
const CARD: string = '@/components/sources/ConsentCard';
const COPY: string = '@/lib/sources/copy';
const cardModule = (await import(CARD).catch(() => null)) as Mod | null;
const copy = (await import(COPY).catch(() => null)) as Mod | null;

async function under<T>(env: Record<string, string>, body: () => Promise<T> | T): Promise<T> {
  const saved = Object.fromEntries(READ.map((name) => [name, process.env[name]]));
  for (const name of READ) delete process.env[name];
  Object.assign(process.env, { SOCRATA_MCP_URL: 'https://socrata.fixture.example', EXECUTOR_DRIVER: 'none' }, env);
  try {
    return await body();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

async function card(): Promise<Surface> {
  assert.ok(cardModule?.default, `no consent card: ${CARD} does not exist`);
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
  installFetch(ORIGIN, {
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
  });
  return mount(h(cardModule!.default as ComponentType<Record<string, unknown>>, {}));
}

function need(name: string): string {
  assert.ok(copy && typeof copy[name] === 'string', `${COPY} exports no ${name}`);
  return copy![name] as string;
}

/** The privacy page's text, as its statements read, with headings. */
function privacyText(): { text: string; headings: string[] } {
  const sections = facts.buildPrivacySections(null) as Array<{ heading: string; statements: Array<{ parts: Array<string | { text?: string; code?: string }> }> }>;
  return {
    headings: sections.map((s) => s.heading),
    text: sections.flatMap((s) => s.statements.map((st) => st.parts.map((p) => (typeof p === 'string' ? p : p.text ?? p.code ?? '')).join(''))).join(' '),
  };
}

const D1 = 'After you withdraw consent, we send no questions until you agree again. Withdrawing cannot take back a question already sent.';

// --- D1 ---------------------------------------------------------------------------------------

test('D1: the privacy page says withdrawing stops what is sent and cannot take back a question already sent; the card does not', async () => {
  await under({}, async () => {
    assert.ok(privacyText().text.includes(D1), 'the privacy page does not carry D1\'s sentence');
    const shown = await card();
    assert.ok(!shown.text().includes(D1), 'the card carries D1\'s sentence, which the ruling keeps out of it');
    shown.unmount();
  });
});

// --- D3 ---------------------------------------------------------------------------------------

test('D3: set, the card\'s endpoint row carries the operator\'s statement, and the privacy page has "The model endpoint"', async () => {
  await under({ SITE_OPERATOR_STATES_NO_TRAINING: '1' }, async () => {
    const statement = need('ENDPOINT_NO_TRAINING');
    assert.match(statement, /do not train/);
    assert.doesNotMatch(statement, /\bsends\b|retain|retention|keep/i, 'the statement says more than training');
    const shown = await card();
    const row = shown.elements().filter((el) => el.props['data-recipient'] === 'model-endpoint');
    assert.equal(row.length, 1, 'premise: the card lists the model endpoint');
    assert.ok(textOf(row[0]).includes(statement), `the endpoint row does not carry the operator's statement: ${textOf(row[0])}`);
    shown.unmount();
    const page = privacyText();
    assert.ok(page.headings.includes(need('PRIVACY_ENDPOINT_HEADING')), 'the privacy page has no "The model endpoint" section');
    assert.ok(page.text.includes(statement), 'the privacy page does not state the operator\'s statement');
  });
});

test('D3: unset, the endpoint row stays as derived and the privacy page has no "The model endpoint" section', async () => {
  await under({}, async () => {
    const statement = need('ENDPOINT_NO_TRAINING');
    const shown = await card();
    const row = shown.elements().filter((el) => el.props['data-recipient'] === 'model-endpoint');
    assert.equal(row.length, 1, 'premise: the card lists the model endpoint');
    assert.ok(!textOf(row[0]).includes(statement), 'the endpoint row states what no operator supplied');
    shown.unmount();
    const page = privacyText();
    assert.ok(!page.headings.includes(need('PRIVACY_ENDPOINT_HEADING')), 'the privacy page has a model-endpoint section no operator supplied');
    assert.ok(!page.text.includes(statement));
  });
});

// --- D4, and correction 5 -----------------------------------------------------------------------

test('D4: the analytics line and the cookie sentence render below Allow and Not now; the full-statement pointer stays above; the buttons are alike', async () => {
  await under({ NEXT_PUBLIC_ANALYTICS_SERVICE: 'plausible', NEXT_PUBLIC_ANALYTICS_ID: 'pa-fixture', DATABASE_URL: 'fixture' }, async () => {
    const shown = await card();
    const markup = shown.text();
    const buttons = markup.indexOf('Not now');
    assert.ok(buttons > 0, 'the card has no Not now');
    assert.ok(markup.indexOf('Allow') < buttons, 'premise: Allow comes first');
    const analytics = need('CARD_ANALYTICS');
    const cookie = need('CARD_COOKIE_WITH_ACCOUNTS');
    assert.ok(markup.indexOf(analytics) > buttons, 'the analytics line is not below the buttons');
    assert.ok(markup.indexOf(cookie) > buttons, 'the cookie sentence is not below the buttons');
    const full = 'The privacy page has the full statement.';
    assert.ok(markup.indexOf(full) >= 0 && markup.indexOf(full) < markup.indexOf('Allow'), 'the full-statement pointer is not above the buttons');
    const [allow] = shown.buttons('Allow');
    const [notNow] = shown.buttons('Not now');
    assert.deepEqual(allow.props.style, notNow.props.style, 'Allow and Not now differ in size or style');
    assert.equal(allow.props.className, notNow.props.className);
    shown.unmount();
  });
});

test('correction 5: the analytics line renders only with analytics configured', async () => {
  const analytics = need('CARD_ANALYTICS');
  await under({ NEXT_PUBLIC_ANALYTICS_SERVICE: 'plausible', NEXT_PUBLIC_ANALYTICS_ID: 'pa-fixture' }, async () => {
    const shown = await card();
    assert.ok(shown.text().includes(analytics), 'with analytics configured, the card does not say so');
    shown.unmount();
  });
  await under({}, async () => {
    const shown = await card();
    assert.ok(!shown.text().includes(analytics), 'with no analytics, the card says an analytics service counts visits');
    shown.unmount();
  });
});

test('correction 5: "on your account" and "your dashboard" render only with a database, on the card and on the privacy page', async () => {
  const cookieWith = need('CARD_COOKIE_WITH_ACCOUNTS');
  const cookieWithout = need('CARD_COOKIE_WITHOUT_ACCOUNTS');
  const withdrawWith = need('WITHDRAW_WITH_ACCOUNTS');
  // T3 (#632 G7), T5 of R9 P3: the card states where to withdraw in its own sentences; the privacy page keeps its own.
  const afterWith = need('CARD_CONTROLS_WITH_ACCOUNTS');
  const afterWithout = need('CARD_CONTROLS_WITHOUT_ACCOUNTS');
  await under({ DATABASE_URL: 'fixture' }, async () => {
    const shown = await card();
    assert.ok(shown.text().includes(cookieWith) && shown.text().includes(afterWith), 'with a database, the card does not say the answer can be kept on an account');
    shown.unmount();
    assert.ok(privacyText().text.includes(withdrawWith));
  });
  await under({}, async () => {
    const shown = await card();
    assert.ok(shown.text().includes(cookieWithout) && shown.text().includes(afterWithout), 'with no database, the card lacks its no-account sentences');
    assert.ok(!/on your account|your dashboard/i.test(shown.text()), 'with no database, the card speaks of an account or a dashboard');
    shown.unmount();
    assert.ok(!/on your account|your dashboard/i.test(privacyText().text), 'with no database, the privacy page speaks of an account or a dashboard');
  });
});

test('fact 4 (Q7, correction 3): both texts say where to withdraw: the panel, or the dashboard\'s Sources tab if signed in', async () => {
  assert.equal(need('WITHDRAW_WITH_ACCOUNTS'), 'To withdraw consent, use the panel beside the question box, or the Sources tab on your dashboard if you are signed in.');
});

test('correction 6: the re-ask sentence says its list is not complete', () => {
  const sections = (copy?.PRIVACY_CONSENT_SECTIONS ?? []) as Array<{ heading: string; sentences: string[] }>;
  const again = sections.find((s) => s.heading === 'When we ask again');
  assert.ok(again, `${COPY} has no "When we ask again" section`);
  assert.ok(again!.sentences.some((s) => s.includes('We ask again when a recipient changes in a way your answer may not cover. For example:')), 'the re-ask sentence reads as a complete list');
});
