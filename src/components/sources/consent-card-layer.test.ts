// R9 P3 (#680; #660, D2 = A of the UX pass): the first-consent card as a decision layer.
//
// CRITERION 1. Above its two buttons the card renders exactly the short layer, in order: the heading,
// T1, T2, T3 (one model service and the statement's sources, counted, then named in a sentence of
// their own), T4 (the statement's recipient count, pointing to the summary by its first words), the
// local-only offer, T5, T6 (the privacy link) and T7. No kept-by line renders above the buttons.
// Directly below them, one `<details>`, shut by default (no `open`), whose summary is T8 with the
// same count; then the analytics line where analytics is on, and the cookie sentence (amendment 1:
// the disclosure below the buttons, so opening it cannot move them). Inside the disclosure: the lead
// line (T11), the base recipients each as a line (the model's labelled "Model service"), the
// sandbox definition directly above the per-source lines (only where a source runs in this site's
// sandbox), and one line per data source grouping its recipients, the sandbox host's kept-by line
// given in full once and named "as above" after. The two buttons keep their size and style.
//
// CRITERION 2 (the parts this file asserts). The flows statement, its base version and its hash, and
// the privacy page's statements, are byte-identical to the base's (`607d101`), pinned below by
// SHA-256 at the configurations this file drives; the re-ask notice's words for the model
// (`consent.ts`) and the privacy page's endpoint heading stay "The model endpoint". "Where this
// question went" is asserted in `src/lib/flows/where-it-went.test.ts`.
//
// THE SANDBOX DEFINITION is the owner's ruling after the second research check (amendment 1), which
// replaced the first ruling's "deleted after the question" because the hosting module keeps the
// sandbox; its two figures are pinned here to `src/lib/mcp/hosting/lifecycle.ts`, read as text, so a
// change to either setting fails.
//
// WHAT IS DRIVEN. The real card on the surface harness (`./surface-test-harness.ts`), reading the
// REAL `/api/flows` and `/api/sources/consent` handlers, at the reference instance's six sources
// (the change log's 2026-10-21 entry, with its five base recipients: 14 in all), at the consent-text
// tests' three sources (five recipients), and at two sources with no hosted one.
//
// WHAT MAKES IT ABLE TO FAIL. Every expected sentence is written out here, never read from
// `copy.ts`. At the base the card lists every recipient above its buttons and has no disclosure; the
// names include a comma-bearing one, so a list joined only by commas reads as seven names, and the
// six-source configuration has four sandbox holders, so a list that prints each in full is counted.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
  readableText,
  registerSurfaceHooks,
  sessions,
  textOf,
  type HostElement,
  type Surface,
} from './surface-test-harness.ts';

// `next/script` renders nothing outside Next; the analytics module imports it.
registerSurfaceHooks({ ...CONSENT_SURFACE_STUBS, 'next/script': 'export default function Script() { return null; }' });

// --- The configurations -------------------------------------------------------------------

const READ = [
  'SOCRATA_MCP_URL', 'NYC_CHARTER_HOSTING', 'NYC_CHECKBOOK_HOSTING', 'NYC_RECORD_HOSTING', 'NYS_LEGISLATION_HOSTING',
  'NYS_LEGISLATION_API_KEY', 'BOSTON_OPENCONTEXT_MCP_URL', 'DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY', 'MODEL_API_BASE_URL',
  'MODEL_API_KIND', 'VERCEL_ENV', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET',
  'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID', 'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST', 'NEXTAUTH_URL',
  'SITE_DEPLOYMENT_GUIDE_URL', 'SITE_OPERATOR_STATES_NO_TRAINING', 'DATABASE_URL', 'EXECUTOR_DRIVER', 'EXECUTOR_LAMBDA_REGION',
];

type Config = 'six' | 'three' | 'two';

/** The reference instance's six sources and five base recipients; the consent-text tests' three; two with none hosted. */
const ENV: Record<Config, Record<string, string>> = {
  six: {
    SOCRATA_MCP_URL: 'https://socrata.fixture.example', NYC_CHARTER_HOSTING: 'sandbox', NYC_CHECKBOOK_HOSTING: 'sandbox',
    NYC_RECORD_HOSTING: 'sandbox', NYS_LEGISLATION_HOSTING: 'sandbox', NYS_LEGISLATION_API_KEY: 'fixture',
    EXECUTOR_DRIVER: 'vercel-sandbox', VERCEL_ENV: 'production', GITHUB_CLIENT_ID: 'fixture', GITHUB_CLIENT_SECRET: 'fixture',
    NEXT_PUBLIC_ANALYTICS_SERVICE: 'plausible', NEXT_PUBLIC_ANALYTICS_ID: 'fixture.example',
  },
  three: { SOCRATA_MCP_URL: 'https://socrata.fixture.example', NYC_CHARTER_HOSTING: 'sandbox', EXECUTOR_DRIVER: 'none' },
  two: { SOCRATA_MCP_URL: 'https://socrata.fixture.example', EXECUTOR_DRIVER: 'none' },
};

async function under<T>(env: Record<string, string>, body: () => Promise<T> | T): Promise<T> {
  const saved = Object.fromEntries(READ.map((name) => [name, process.env[name]]));
  for (const name of READ) delete process.env[name];
  Object.assign(process.env, env);
  try {
    return await body();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

// --- The modules -------------------------------------------------------------------------------

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const Card = (await load('components/sources/ConsentCard.tsx')).default as ComponentType<Record<string, unknown>>;
const flowsRoute = await load('app/api/flows/route.ts');
const consentRoute = await load('app/api/sources/consent/route.ts');
const { buildFlowsStatement, statementHash } = await load('lib/flows/statement.ts');
const { readerSourceName } = await load('lib/sources/source-name.ts');
const facts = await load('lib/privacy-facts.ts');
const copy = await load('lib/sources/copy.ts');

const ORIGIN = 'https://site.fixture.example';

async function card(): Promise<Surface> {
  sessions.server = null;
  sessions.client = { status: 'unauthenticated', data: null };
  installFetch(ORIGIN, {
    '/api/flows': () => flowsRoute.GET(),
    '/api/sources/consent': (request: Request) => (consentRoute[request.method] as (r: Request) => Promise<Response>)(request),
  });
  return mount(h(Card, { onAllow: () => undefined, onNotNow: () => undefined }));
}

// --- The ruled words, written out ------------------------------------------------------------

const HEADING = 'Before your first question';
const T1 = 'To answer, this site sends your question to a model service, and sends the searches the model writes to the data sources that are On.';
// Amendment 1 (the owner's rulings after the second research check): T2 is the privacy page's ruled sentence.
const T2 = 'Your question is not sent beyond this site before you answer.';
const T3: Record<Config, string> = {
  six: 'Your question can reach one model service and six data sources. They are Socrata; Data Commons; NYC Charter, Laws and Rules; NYC Checkbook; NYC City Record; and NYS Open Legislation.',
  three: 'Your question can reach one model service and three data sources. They are Socrata; Data Commons; and NYC Charter, Laws and Rules.',
  two: 'Your question can reach one model service and two data sources. They are Socrata and Data Commons.',
};
const COUNT: Record<Config, { n: number; words: string }> = { six: { n: 14, words: '14' }, three: { n: 5, words: 'five' }, two: { n: 4, words: 'four' } };
const T4 = (words: string) => `What each of the ${words} recipients says it keeps is listed below, under "Show the ${words} recipients".`;
const LOCAL_ONLY = 'You can also run this whole system on your own computer, with your own model and data sources. This site does not name a deployment guide.';
const T5_NO_DB = 'You can set each source to On, Ask first or Off beside the question box at any time. You can withdraw consent there.';
const T5_DB = "You can set each source to On, Ask first or Off beside the question box at any time. You can withdraw consent there, or on your dashboard's Sources tab if you are signed in.";
const T6 = 'The privacy page has the full statement.';
const T7 = '"Allow" turns on the sources shown as On and sends your question. "Not now" sends nothing.';
const T8 = (words: string) => `Show the ${words} recipients and what each says it keeps`;
const T10 = 'A sandbox is a computer this site creates in the cloud to search a data source. It stops when no one has searched for 10 minutes. This site keeps a saved copy of it for 30 days after its last use.';
const T11 = 'The searches the model writes can include words from your question.';
const ANALYTICS = 'An analytics service counts page visits. The privacy page names it and says how to object.';
const COOKIE_NO_DB = 'We keep your answer for this browser session in a cookie.';

/** The buttons as the base styles them (D4 = A): equal, and unchanged by this phase. */
const BUTTON_STYLE = {
  flex: '1 1 0', minWidth: '120px', padding: '10px 16px', fontSize: '14px', fontWeight: 600, borderRadius: '6px',
  border: '1px solid var(--accent)', backgroundColor: 'var(--white)', color: 'var(--accent)', cursor: 'pointer',
};

/** Words that only a kept-by line carries. */
const KEPT_BY_WORDS = ['not stated', 'says it keeps facts', 'says it keeps what', 'says it keeps nothing', 'its statement', 'read 2026-', 'for this site\'s operator to state'];

interface Shown {
  surface: Surface;
  statement: Mod;
  elements: HostElement[];
  /** What a reader reads before the first button. */
  above: string;
  /** What a reader reads from the first button on. */
  below: string;
  firstButton: number;
}

async function show(config: Config, extra: Record<string, string> = {}): Promise<Shown> {
  return under({ ...ENV[config], ...extra }, async () => {
    const statement = await buildFlowsStatement();
    const surface = await card();
    const markup = surface.markup();
    const cut = markup.indexOf('<button');
    assert.ok(cut > 0, `premise: the card has its buttons: ${surface.text().slice(0, 300)}`);
    const elements = surface.elements();
    return {
      surface, statement, elements,
      above: readableText(markup.slice(0, cut)),
      below: readableText(markup.slice(cut)),
      firstButton: elements.findIndex((el) => el.type === 'button'),
    };
  });
}

/**
 * A line as a reader reads it: `textOf` turns every tag into a space, so "<strong>Socrata</strong>: "
 * reads "Socrata : "; the space before a mark and after an opening parenthesis is the harness's, not
 * the page's (the headless Chrome read in the phase report shows the page's own spacing).
 */
const tidy = (text: string): string => text.replace(/\s+([:;,.)])/g, '$1').replace(/\(\s+/g, '(');

const recipientsOf = (statement: Mod): Mod[] => [...statement.recipients, ...statement.sources.flatMap((s: Mod) => s.recipients)];

// --- Criterion 1 ---------------------------------------------------------------------------------

for (const config of ['six', 'three', 'two'] as const) {
  test(`criterion 1 (${config} sources): above the buttons, exactly the short layer, with the statement's count and names`, async () => {
    const { surface, statement, above, elements, firstButton } = await show(config);
    try {
      assert.equal(statement.sources.length, { six: 6, three: 3, two: 2 }[config], 'premise: the configuration\'s sources');
      assert.equal(recipientsOf(statement).length, COUNT[config].n, 'premise: the statement\'s recipient count');
      assert.deepEqual(statement.sources.map((s: Mod) => readerSourceName(s)).length, statement.sources.length);
      const expected = [HEADING, T1, T2, T3[config], T4(COUNT[config].words), LOCAL_ONLY, T5_NO_DB, T6, T7].join(' ');
      assert.equal(above, expected, 'the text above the buttons is not the short layer');
      for (const words of KEPT_BY_WORDS) assert.ok(!above.includes(words), `a kept-by line renders above the buttons ("${words}")`);
      const recipientLines = elements.map((el, i) => [el, i] as const).filter(([el]) => typeof el.props['data-recipient'] === 'string');
      assert.ok(recipientLines.length > 0, 'premise: the card lists its recipients somewhere');
      assert.ok(recipientLines.every(([, i]) => i > firstButton), 'a recipient line renders above the buttons');
    } finally {
      surface.unmount();
    }
  });

  test(`criterion 1 (${config} sources): the recipients sit in one disclosure, closed by default, whose summary carries the count`, async () => {
    const { surface, statement, elements, below } = await show(config);
    try {
      const details = elements.filter((el) => el.type === 'details');
      assert.equal(details.length, 1, 'the card has no disclosure, or more than one');
      const [disclosure] = details;
      assert.ok(!disclosure.props.open, 'the disclosure is open by default');
      assert.ok('data-consent-recipients' in disclosure.props, 'the disclosure is not marked data-consent-recipients');
      const summaries = elements.filter((el) => el.type === 'summary');
      assert.equal(summaries.length, 1);
      assert.equal(textOf(summaries[0]), T8(COUNT[config].words), 'the summary does not carry the statement\'s count');
      const inside = textOf(disclosure);
      // Every recipient's line is inside the disclosure, in the statement's order.
      const inner = elements.slice(elements.indexOf(disclosure));
      const listed = inner.filter((el) => typeof el.props['data-recipient'] === 'string').map((el) => el.props['data-recipient']);
      assert.deepEqual(listed, recipientsOf(statement).map((r) => r.id), 'the disclosure does not list exactly the statement\'s recipients, in order');
      // The lead line first, after the summary.
      assert.ok(inside.startsWith(`${T8(COUNT[config].words)} ${T11}`), `the disclosure does not open with its lead line: ${inside.slice(0, 200)}`);
      // The base recipients each as a line, the model's labelled "Model service".
      for (const r of statement.recipients as Mod[]) {
        const line = inner.find((el) => el.type === 'li' && el.props['data-recipient'] === r.id);
        assert.ok(line, `${r.id}: no line of its own`);
      }
      const model = inner.find((el) => el.props['data-recipient'] === 'model-endpoint');
      assert.ok(textOf(model!).startsWith('Model service ('), `the model's line is not labelled "Model service": ${textOf(model!)}`);
      assert.ok(!/model endpoint/i.test(surface.text()), 'the card still says "model endpoint"');
      // One line per data source, grouping its recipients.
      const groups = inner.filter((el) => typeof el.props['data-recipient-group'] === 'string');
      assert.deepEqual(groups.map((g) => g.props['data-recipient-group']), statement.sources.map((s: Mod) => s.sourceId), 'not one line per data source');
      for (const source of statement.sources as Mod[]) {
        const group = groups.find((g) => g.props['data-recipient-group'] === source.sourceId)!;
        const text = tidy(textOf(group));
        assert.ok(text.startsWith(`${readerSourceName(source)}: `), `${source.sourceId}: the line does not open with its name: ${text}`);
        for (const r of source.recipients as Mod[]) {
          const span = elements.find((el) => el.props['data-recipient'] === r.id)!;
          assert.ok(text.includes(tidy(textOf(span))), `${r.id}: its clause is not on its source's line`);
          const verb = r.runsAt === 'instance-sandbox' ? "runs in this site's sandbox — " : `reaches ${r.host} — `;
          assert.ok(textOf(span).toLowerCase().startsWith(verb.toLowerCase()), `${r.id}: the clause reads ${textOf(span)}`);
        }
      }
      // The definition: directly above the per-source lines, and only where a source runs in this site's sandbox.
      const definitions = inner.filter((el) => el.type === 'p' && textOf(el) === T10);
      const hosted = statement.sources.some((s: Mod) => s.recipients.some((r: Mod) => r.runsAt === 'instance-sandbox'));
      assert.equal(definitions.length, hosted ? 1 : 0, hosted ? 'no sandbox definition' : 'a sandbox definition where no source runs in one');
      if (hosted) {
        const at = inner.indexOf(definitions[0]);
        assert.equal(inner[at + 1]?.type, 'ul', 'the definition is not directly above the per-source list');
        assert.equal(inner.indexOf(groups[0]), at + 2, 'the definition is not directly above the per-source lines');
        assert.ok(inside.indexOf(T10) > inside.indexOf(textOf(inner.find((el) => el.props['data-recipient'] === statement.recipients.at(-1).id)!)), 'the definition is not after the base recipients');
      }
      // Amendment 1: the disclosure sits directly below the two buttons, so opening it cannot move them;
      // the analytics line where analytics is on and the cookie sentence follow it.
      const lastButton = elements.map((el) => el.type).lastIndexOf('button');
      assert.equal(elements[lastButton + 1], disclosure, 'the disclosure is not the element directly below the two buttons');
      assert.ok(elements.indexOf(disclosure) > lastButton, 'part of the disclosure renders above the buttons');
      const summaryAt = below.indexOf(T8(COUNT[config].words));
      const cookie = below.indexOf(COOKIE_NO_DB);
      assert.ok(summaryAt > 0 && cookie > summaryAt, 'the cookie sentence is not below the disclosure');
      if (config === 'six') {
        const analytics = below.indexOf(ANALYTICS);
        assert.ok(analytics > summaryAt && analytics < cookie, 'the analytics line is not between the disclosure and the cookie sentence');
      }
    } finally {
      surface.unmount();
    }
  });
}

test('criterion 1 (six sources): the sandbox host\'s kept-by line is given in full once; each later sandbox names it "as above"', async () => {
  const { surface, statement, elements } = await show('six');
  try {
    const sandboxes = recipientsOf(statement).filter((r) => r.runsAt === 'instance-sandbox');
    assert.equal(sandboxes.length, 4, 'premise: four sources run in this site\'s sandbox');
    const holder = sandboxes[0].keptBy[0];
    assert.ok(sandboxes.every((r) => JSON.stringify(r.keptBy) === JSON.stringify([holder])), 'premise: the four sandboxes have one holder line');
    const groups = elements.filter((el) => typeof el.props['data-recipient-group'] === 'string');
    const lines = groups.map((g) => tidy(textOf(g))).join(' ');
    assert.equal(lines.split(`${holder.holder}: not stated (its statement, read ${holder.readOn})`).length - 1, 1, `the sandbox host's line is not given once: ${lines}`);
    assert.equal(lines.split(`${holder.holder}, as above`).length - 1, 3, `the later sandboxes do not say "as above": ${lines}`);
    assert.equal(elements.filter((el) => el.type === 'a' && el.props.href === holder.statementUrl).length, 1, 'the sandbox host\'s statement is linked other than once');
    // One hosted line, written out: Checkbook, its sandbox "as above", then its upstream host.
    const checkbook = statement.sources.find((s: Mod) => s.sourceId === 'nyc-checkbook');
    const upstream = checkbook.recipients[1];
    const [k] = upstream.keptBy;
    assert.equal(
      tidy(textOf(groups.find((g) => g.props['data-recipient-group'] === 'nyc-checkbook')!)),
      `NYC Checkbook: runs in this site's sandbox — Vercel, as above. Reaches ${upstream.host} — ${k.holder}: not stated (its statement, read ${k.readOn}).`,
    );
    assert.equal(
      tidy(textOf(groups.find((g) => g.props['data-recipient-group'] === 'nyc-charter')!)),
      `NYC Charter, Laws and Rules: runs in this site's sandbox — Vercel: not stated (its statement, read ${holder.readOn}).`,
    );
  } finally {
    surface.unmount();
  }
});

test('criterion 1: with a database, T5 names the dashboard, in its two sentences', async () => {
  const { surface, above } = await show('three', { DATABASE_URL: 'fixture' });
  try {
    assert.ok(above.includes(`${T5_DB} ${T6}`), `T5 with a database does not render above the buttons: ${above}`);
  } finally {
    surface.unmount();
  }
});

test('criterion 1: the two buttons are unchanged in size and style, and still read Allow and Not now', async () => {
  const { surface } = await show('six');
  try {
    const [allow] = surface.buttons('Allow');
    const [notNow] = surface.buttons('Not now');
    assert.ok(allow && notNow, 'the card does not offer Allow and Not now');
    assert.deepEqual(allow.props.style, BUTTON_STYLE, 'Allow\'s style changed');
    assert.deepEqual(notNow.props.style, BUTTON_STYLE, 'Not now\'s style changed');
    assert.equal(allow.props.className, notNow.props.className);
  } finally {
    surface.unmount();
  }
});

// --- The sandbox definition's figures, pinned to the hosting module (a hypothesis for the check) ----

test('the sandbox definition\'s figures are the hosting module\'s: 10 minutes idle, a snapshot kept 30 days after its last use', () => {
  const lifecycle = fs.readFileSync(path.join(SRC, 'lib/mcp/hosting/lifecycle.ts'), 'utf8');
  assert.match(lifecycle, /export const DEFAULT_IDLE_WINDOW_MS = 10 \* 60_000;/, 'the idle window is no longer 10 minutes');
  assert.match(lifecycle, /const SNAPSHOT_EXPIRATION_MS = 30 \* 24 \* 60 \* 60_000;/, 'the snapshot expiry is no longer 30 days');
  assert.match(lifecycle, /persistent: true,/, 'a hosted source\'s sandbox is no longer persistent: the definition\'s "stops" and "saved copy" may no longer hold');
  assert.match(lifecycle, /keepLastSnapshots: \{ count: 1 \}/);
  assert.equal(copy.CARD_SANDBOX_DEFINITION, T10);
});

// --- Criterion 2: what this phase leaves byte for byte ---------------------------------------------

const sha = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

/** Captured at the base (`607d101`) by this file's own computation, before any change. */
const BASE: Record<'six' | 'three', { statement: string; version: string; hash: string; privacy: string }> = {
  six: {
    statement: 'df07040107fbcf939d9ad594cbdb8f21b22e538c90022b474483f0c2853f4669',
    version: '2489d0dda25a79b3286c380379c6d2c8202e66a77fe5b4f493f558a7ce190f9c',
    hash: '7683b5d59e2b39df3f941420a5ce44ad14539992d2b6850df60f7aa64fe4bc60',
    privacy: '04d555fa05c0d5f1155176a13be2a018025e7b4097011d56bde82884d803e9c6',
  },
  three: {
    statement: '522fc92cad73b13f15ede0acaf16ce32b139d4b1438a5ee84dbe0d414c88813a',
    version: 'ce0f4f09dff9d9d998a00cca59b12ee92486752ce9d94ed1eb310eae01c69325',
    hash: '159e0475172c58c49d51f654dec0b74e75d24639452c7b1ff73eaf0558242696',
    privacy: '1c0e14ad571f74d380f3ecc4f93d9a60b049185583756122e23883cf61f6fe6c',
  },
};
const BASE_PRIVACY_CONSENT_SECTIONS = 'a33e19a6d21aa7c3ff2e5d806a635fbd5ea5067995057d08b622e4906b1d18d1';

for (const config of ['six', 'three'] as const) {
  test(`criterion 2 (${config} sources): the flows statement, its base version and hash, and the privacy page's statements are the base's, byte for byte`, async () => {
    await under(ENV[config], async () => {
      const statement = await buildFlowsStatement();
      const now = {
        statement: sha(statement),
        version: statement.version,
        hash: statementHash(statement),
        privacy: sha(facts.buildPrivacySections(null)),
      };
      assert.deepEqual(now, BASE[config], 'the statement, its version or hash, or the privacy page moved: a re-ask, or a changed page');
    });
  });
}

test('criterion 2: the privacy page\'s consent sections, its endpoint heading and the re-ask notice\'s word for the model are unchanged', () => {
  assert.equal(sha(copy.PRIVACY_CONSENT_SECTIONS), BASE_PRIVACY_CONSENT_SECTIONS, 'the privacy page\'s consent sections changed');
  assert.equal(copy.PRIVACY_ENDPOINT_HEADING, 'The model endpoint');
  const consent = fs.readFileSync(path.join(SRC, 'lib/sources/consent.ts'), 'utf8');
  assert.ok(consent.includes("  'model-endpoint': 'The model endpoint',"), 'the re-ask notice\'s words for the model changed');
});
