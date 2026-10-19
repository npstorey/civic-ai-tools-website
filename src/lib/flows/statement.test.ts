// R6 W2 (#632), criterion 3: the flows statement, derived at request time
// (D7 = A), and its three digests.
//
// WHAT IS DRIVEN. `buildFlowsStatement()` in `src/lib/flows/statement.ts`,
// under three configurations: the default, a custom model endpoint, and
// `NYC_CHARTER_HOSTING=sandbox`. Each is built from this process's environment,
// set here, with every variable the statement reads cleared first.
//
// WHAT EACH ASSERTION CAN FAIL ON.
//   - the recipients list names exactly the configured hosts: the set of hosts
//     the statement names is compared to the set the configuration names, in
//     both directions, so an extra host and a missing one each fail;
//   - under Charter's switch its sandbox recipient appears in Charter's own row,
//     and the base `version` equals the default's: a builder that put the
//     sandbox platform in the base would move it;
//   - the base `version` moves with an instance-level recipient added, a posture
//     changed or a hosting arrangement changed, and not with a source
//     configured or the `date` alone;
//   - a source's own `version` moves with its variant or its posture, and not
//     with its freshness line;
//   - nothing here reaches the network: a census of `fetch` reads zero (design
//     §2.4 rule 1: a source is never woken by being shown).
//
// The two-way rule over the derived guard's source (a statement that names a
// recipient the guard's source does not list fails) is in
// `src/lib/privacy-recipients.test.ts`, beside the guard it extends.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/flows/statement.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// `src/lib/device-flow.ts`, which the ruling-2 test below imports to pin the
// statement's origin to `getBaseUrl`, imports `./host-routing` with no
// extension, which Next resolves and plain `node --test` does not; this
// resolves such a specifier to its `.ts` file.
{
  const nodeModule = await import('node:module');
  const nodePath = await import('node:path');
  const nodeFs = await import('node:fs');
  const nodeUrl = await import('node:url');
  type R = { url: string; format?: string | null; shortCircuit?: boolean };
  (nodeModule as unknown as { registerHooks(h: { resolve(s: string, c: unknown, n: (s: string, c?: unknown) => R): R }): void }).registerHooks({
    resolve(specifier, context, nextResolve) {
      const parent = (context as { parentURL?: string }).parentURL;
      if (specifier.startsWith('.') && !nodePath.extname(specifier) && parent?.startsWith('file:')) {
        const candidate = `${nodePath.resolve(nodePath.dirname(nodeUrl.fileURLToPath(parent)), specifier)}.ts`;
        if (nodeFs.existsSync(candidate)) return { url: nodeUrl.pathToFileURL(candidate).href, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
}

/** The module this phase adds (a specifier typed `string`; see `adapt-record.test.ts`). */
const STATEMENT: string = './statement.ts';

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const mod = (await import(STATEMENT).catch(() => null)) as Mod | null;

function need<T = any>(name: string): T { // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.ok(mod, `no flows statement module: ${STATEMENT} does not exist`);
  assert.ok(name in mod!, `${STATEMENT} exports no ${name}`);
  return mod![name] as T;
}

interface KeptBy { holder: string; keeps: string; retention?: string; statementUrl?: string; readOn?: string }
interface Recipient { id: string; key: string; role: string; host?: string; runsAt?: string; receives: string; keptBy: KeptBy[] }
interface Source { sourceId: string; publisher: string; variant: Record<string, unknown>; host?: string; freshness: string; recipients: Recipient[]; version: string }
interface Statement { version: string; date: string; recipients: Recipient[]; sources: Source[]; links: Record<string, unknown> }

// --- The configurations ---------------------------------------------------------

const READ = [
  'MODEL_API_BASE_URL', 'MODEL_API_KIND', 'VERCEL_ENV', 'EXECUTOR_DRIVER', 'EXECUTOR_LAMBDA_REGION',
  'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_PROVIDER_NAME',
  'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID', 'NEXT_PUBLIC_GA_MEASUREMENT_ID',
  'SOCRATA_MCP_URL', 'DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY', 'BOSTON_OPENCONTEXT_MCP_URL', 'NYC_CHARTER_HOSTING',
  'APP_HOST', 'NEXTAUTH_URL',
];

const SOCRATA = 'https://socrata.fixture.example';

async function under(env: Record<string, string>): Promise<Statement> {
  const saved = Object.fromEntries(READ.map((name) => [name, process.env[name]]));
  for (const name of READ) delete process.env[name];
  Object.assign(process.env, { SOCRATA_MCP_URL: SOCRATA, EXECUTOR_DRIVER: 'none' }, env);
  try {
    return (await need<() => Promise<Statement>>('buildFlowsStatement')()) as Statement;
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

const realFetch = globalThis.fetch;
const FETCHED: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  FETCHED.push(String(input instanceof Request ? input.url : input));
  throw new TypeError('the flows statement made a network request');
}) as typeof fetch;

const DEFAULT = await under({}).catch(() => null);
const CUSTOM_MODEL = await under({ MODEL_API_BASE_URL: 'https://models.fixture.example/v1' }).catch(() => null);
const CHARTER = await under({ NYC_CHARTER_HOSTING: 'sandbox' }).catch(() => null);
globalThis.fetch = realFetch;

function built(statement: Statement | null, what: string): Statement {
  need('buildFlowsStatement');
  assert.ok(statement, `buildFlowsStatement() threw under ${what}`);
  return statement!;
}

/** Every host the statement names, base and sources. */
function hostsOf(statement: Statement): string[] {
  const hosts = new Set<string>();
  for (const r of statement.recipients) if (r.host) hosts.add(r.host);
  for (const s of statement.sources) {
    if (s.host) hosts.add(s.host);
    for (const r of s.recipients) if (r.host) hosts.add(r.host);
  }
  return [...hosts].sort();
}

// --- Shape ----------------------------------------------------------------------------

test('criterion 3: the statement carries version, date, recipients, sources and links, and each recipient its kept-by lines', () => {
  const s = built(DEFAULT, 'the default');
  assert.match(s.version, /^[0-9a-f]{64}$/);
  assert.match(s.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(Object.keys(s).sort(), ['date', 'links', 'recipients', 'sources', 'version']);
  for (const r of [...s.recipients, ...s.sources.flatMap((x) => x.recipients)]) {
    assert.ok(r.role && r.receives && (r.host || r.runsAt), `recipient ${r.id} lacks a role, what it receives, or where it is`);
    assert.ok(r.keptBy.length > 0, `recipient ${r.id} has no kept-by line`);
    for (const k of r.keptBy) {
      assert.ok(['none', 'metadata', 'content', 'not-stated', 'not-read', 'operator-states'].includes(k.keeps), `${r.id}: keeps "${k.keeps}"`);
      if (['none', 'metadata', 'content', 'not-stated'].includes(k.keeps)) {
        assert.match(k.statementUrl ?? '', /^https:\/\//, `${r.id}: a statement that was read names its address`);
        assert.match(k.readOn ?? '', /^\d{4}-\d{2}-\d{2}$/, `${r.id}: a statement that was read names its read date`);
      }
    }
  }
});

test('criterion 3: links name the privacy page, and say the instance names no deployment guide (W3 adds the variable)', () => {
  const s = built(DEFAULT, 'the default');
  assert.equal(s.links.privacy, '/privacy');
  assert.equal(Object.hasOwn(s.links, 'deploymentGuide'), false, 'a deployment guide address with no variable to read it from');
  assert.match(String(s.links.deploymentGuideOmitted ?? ''), /deployment guide/i, 'the omission is not stated');
});

// --- The three configurations -----------------------------------------------------------

test('criterion 3 (default): the recipients name exactly the configured hosts', () => {
  const s = built(DEFAULT, 'the default');
  assert.deepEqual(hostsOf(s), ['api.datacommons.org', 'openrouter.ai', 'socrata.fixture.example']);
  assert.deepEqual(s.recipients.map((r) => r.role), ['model-endpoint', 'function-logs'], 'no sign-in, analytics or notebook executor is configured');
  assert.deepEqual(s.sources.map((x) => x.sourceId), ['socrata', 'data-commons']);
});

test('criterion 3 (custom model endpoint): the model recipient names the configured host, and the base version moves', () => {
  const s = built(CUSTOM_MODEL, 'a custom model endpoint');
  const d = built(DEFAULT, 'the default');
  assert.deepEqual(hostsOf(s), ['api.datacommons.org', 'models.fixture.example', 'socrata.fixture.example']);
  assert.equal(s.recipients.find((r) => r.role === 'model-endpoint')?.host, 'models.fixture.example');
  assert.notEqual(s.version, d.version, 'a different model endpoint is a different hosting arrangement');
  assert.deepEqual(s.sources.map((x) => x.version), d.sources.map((x) => x.version), 'the sources\' own versions do not move with the model endpoint');
});

test('criterion 3 (NYC_CHARTER_HOSTING=sandbox): Charter\'s sandbox recipient is in Charter\'s row, and the base is unchanged', () => {
  const s = built(CHARTER, 'Charter on');
  const d = built(DEFAULT, 'the default');
  assert.equal(s.version, d.version, 'configuring a source moved the base version');
  assert.deepEqual(s.recipients, d.recipients, 'configuring a source changed the instance-level recipients');
  assert.deepEqual(hostsOf(s), hostsOf(d), 'Charter runs in this site\'s sandbox and adds no host');
  const charter = s.sources.find((x) => x.sourceId === 'nyc-charter');
  assert.ok(charter, 'Charter has no row while its switch is on');
  assert.equal(charter!.variant.kind, 'npm-package');
  assert.equal(charter!.variant.runsAt, 'instance-sandbox');
  assert.equal(charter!.publisher, 'BetaNYC');
  const sandbox = charter!.recipients.find((r) => r.role === 'sandbox-platform');
  assert.ok(sandbox, 'Charter\'s row names no sandbox platform');
  assert.equal(sandbox!.key, 'held:sandbox-platform');
  assert.equal(sandbox!.keptBy[0]?.keeps, 'not-stated', 'the sandbox platform\'s pages say nothing about what it keeps');
  assert.ok(!d.sources.some((x) => x.sourceId === 'nyc-charter'), 'Charter has a row while its switch is off');
});

test('criterion 3: a stated posture is carried from the manifest, with its holder, address and read date', () => {
  const dc = built(DEFAULT, 'the default').sources.find((x) => x.sourceId === 'data-commons');
  assert.deepEqual(dc?.recipients[0].keptBy[0] && { holder: dc.recipients[0].keptBy[0].holder, keeps: dc.recipients[0].keptBy[0].keeps, statementUrl: dc.recipients[0].keptBy[0].statementUrl, readOn: dc.recipients[0].keptBy[0].readOn }, {
    holder: 'Google',
    keeps: 'content',
    statementUrl: 'https://policies.google.com/privacy?hl=en-US',
    readOn: '2026-10-18',
  });
});

test('design §2.4 rule 1: building the statement makes no network request', () => {
  built(DEFAULT, 'the default');
  assert.deepEqual(FETCHED, []);
});

// --- The digests ----------------------------------------------------------------------------

test('criterion 3: the base version moves when an instance-level recipient is added or its posture or hosting changes', async () => {
  const d = built(DEFAULT, 'the default');
  const computeBase = need<(recipients: Recipient[]) => string>('computeBaseVersion');
  assert.equal(computeBase(d.recipients), d.version, 'the base version is the digest of the instance-level recipients');

  const added = await under({ EXECUTOR_DRIVER: 'vercel-sandbox' });
  assert.ok(added.recipients.some((r) => r.role === 'notebook-executor'), 'premise: a notebook executor is a recipient');
  assert.notEqual(added.version, d.version, 'a recipient added');

  const posture = JSON.parse(JSON.stringify(d.recipients)) as Recipient[];
  posture[0].keptBy[0].keeps = posture[0].keptBy[0].keeps === 'content' ? 'metadata' : 'content';
  assert.notEqual(computeBase(posture), d.version, 'a posture changed');

  const hosting = await under({ VERCEL_ENV: 'production' });
  assert.notEqual(hosting.recipients.find((r) => r.role === 'function-logs')?.keptBy[0]?.holder, d.recipients.find((r) => r.role === 'function-logs')?.keptBy[0]?.holder, 'premise: on the hosting platform its function logs have another holder');
  assert.notEqual(hosting.version, d.version, 'a hosting arrangement changed');
});

test('criterion 3: the base version does not move when a source is configured or the date alone changes', async () => {
  const d = built(DEFAULT, 'the default');
  const boston = await under({ BOSTON_OPENCONTEXT_MCP_URL: 'https://boston.fixture.example/mcp' });
  assert.ok(boston.sources.some((x) => x.sourceId === 'boston-opencontext'), 'premise: Boston has a row once configured');
  assert.equal(boston.version, d.version);
  const computeBase = need<(recipients: Recipient[]) => string>('computeBaseVersion');
  assert.equal(computeBase({ ...d, date: '2099-01-01' }.recipients), d.version);
  const hashOf = need<(s: Statement) => string>('statementHash');
  assert.notEqual(hashOf({ ...d, date: '2099-01-01' }), hashOf(d), 'the date is in the statement\'s own hash, though not in its base version');
});

test('criterion 3: a source\'s own version moves with its variant or its posture, and not with its freshness line', () => {
  const d = built(DEFAULT, 'the default');
  const computeSource = need<(source: Source) => string>('computeSourceVersion');
  const dc = d.sources.find((x) => x.sourceId === 'data-commons')!;
  assert.equal(computeSource(dc), dc.version);
  const variant = { ...JSON.parse(JSON.stringify(dc)), variant: { ...dc.variant, variant: 'self-hosted', runsAt: 'other' } } as Source;
  assert.notEqual(computeSource(variant), dc.version, 'a variant changed');
  const posture = JSON.parse(JSON.stringify(dc)) as Source;
  posture.recipients[0].keptBy[0].keeps = 'none';
  assert.notEqual(computeSource(posture), dc.version, 'a posture changed');
  assert.equal(computeSource({ ...dc, freshness: 'Some other line.' }), dc.version, 'a freshness line moved a source version');
});

test('the statement\'s hash is the SHA-256 of the bytes /api/flows serves', () => {
  const d = built(DEFAULT, 'the default');
  const serialize = need<(s: Statement) => string>('serializeFlowsStatement');
  const hashOf = need<(s: Statement) => string>('statementHash');
  assert.equal(hashOf(d), createHash('sha256').update(serialize(d), 'utf8').digest('hex'));
  assert.equal(serialize(JSON.parse(serialize(d)) as Statement), serialize(d), 'the served bytes are canonical: a parsed copy serializes to the same bytes');
});

// --- The record's reference: url, hash, date (ruling 2) ---------------------------------------

test('ruling 2: the reference is getBaseUrl(request) plus /api/flows, under each of its three branches, with exactly url, hash and date', () => {
  const reference = need<(s: Statement, request: Request) => Record<string, string>>('flowsStatementReference');
  const d = built(DEFAULT, 'the default');
  const hashOf = need<(s: Statement) => string>('statementHash');
  const request = new Request('https://preview-123.fixture.example/api/compare-stream', { method: 'POST' });
  const saved = { APP_HOST: process.env.APP_HOST, NEXTAUTH_URL: process.env.NEXTAUTH_URL };
  try {
    process.env.APP_HOST = 'app.fixture.example';
    process.env.NEXTAUTH_URL = 'https://auth.fixture.example/';
    assert.equal(reference(d, request).url, 'https://app.fixture.example/api/flows', 'APP_HOST wins');
    delete process.env.APP_HOST;
    assert.equal(reference(d, request).url, 'https://auth.fixture.example/api/flows', 'then NEXTAUTH_URL');
    delete process.env.NEXTAUTH_URL;
    const ref = reference(d, request);
    assert.equal(ref.url, 'https://preview-123.fixture.example/api/flows', 'then the request origin');
    assert.deepEqual(Object.keys(ref), ['url', 'hash', 'date']);
    assert.equal(ref.hash, hashOf(d));
    assert.equal(ref.date, d.date);
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('every instance-stated log holder the manifest names by role has a posture the statement states', async () => {
  const { CIVIC_MANIFEST } = await import('@typedstandards/civic-typed-router');
  const postures = need<Record<string, unknown>>('INSTANCE_ROLE_POSTURES');
  const roles = new Set<string>();
  for (const entry of CIVIC_MANIFEST) for (const variant of entry.hostings) for (const holder of variant.logging) if (holder.statedBy === 'instance') roles.add(holder.role);
  assert.ok(roles.size >= 3, `premise: the manifest names ${roles.size} instance-stated roles`);
  assert.deepEqual([...roles].filter((role) => !Object.hasOwn(postures, role)), [], 'a role with no posture');
  assert.deepEqual(Object.keys(postures).filter((role) => !roles.has(role)), [], 'a posture for a role no entry names');
});

// --- The date is the content date (the ORCH's constraint on the digests) -------------------

test('the same configuration on two clock days serves the same bytes and the same hash', async () => {
  const serialize = need<(s: Statement) => string>('serializeFlowsStatement');
  const RealDate = Date;
  const at = async (iso: string) => {
    const fixed = RealDate.parse(iso);
    class FixedDate extends RealDate {
      constructor(...args: unknown[]) { if (args.length === 0) super(fixed); else super(...(args as [number])); }
      static now() { return fixed; }
    }
    globalThis.Date = FixedDate as unknown as DateConstructor;
    try {
      return await under({});
    } finally {
      globalThis.Date = RealDate;
    }
  };
  const monday = await at('2026-10-19T23:59:59.000Z');
  const tuesday = await at('2026-10-20T00:00:01.000Z');
  assert.equal(serialize(tuesday), serialize(monday), 'the served bytes moved with the clock');
  assert.equal(monday.date, built(DEFAULT, 'the default').date);
  const reads = [...monday.recipients, ...monday.sources.flatMap((s) => s.recipients)].flatMap((r) => r.keptBy.map((k) => k.readOn)).filter(Boolean) as string[];
  assert.equal(monday.date, reads.sort().at(-1), 'the date is the latest read date the statement carries');
});

test('a re-read with an unchanged posture moves the date and the hash, and neither version', () => {
  const d = built(DEFAULT, 'the default');
  const assemble = need<(parts: Pick<Statement, 'recipients' | 'sources' | 'links'>) => Statement>('assembleFlowsStatement');
  const hashOf = need<(s: Statement) => string>('statementHash');
  const computeSource = need<(source: Source) => string>('computeSourceVersion');
  const sources = JSON.parse(JSON.stringify(d.sources)) as Source[];
  const dc = sources.find((s) => s.sourceId === 'data-commons')!;
  dc.recipients[0].keptBy[0].readOn = '2027-01-15';
  const reread = assemble({ recipients: d.recipients, sources, links: d.links });
  assert.equal(reread.date, '2027-01-15', 'the date did not move with the re-read');
  assert.notEqual(hashOf(reread), hashOf(d), 'the hash did not move with the re-read');
  assert.equal(reread.version, d.version, 'the base version moved with a re-read');
  assert.equal(computeSource(dc), d.sources.find((s) => s.sourceId === 'data-commons')!.version, 'the source version moved with a re-read');
});

test('a change in what a recipient receives moves the base version (a changed arrangement)', () => {
  const d = built(DEFAULT, 'the default');
  const computeBase = need<(recipients: Recipient[]) => string>('computeBaseVersion');
  const changed = JSON.parse(JSON.stringify(d.recipients)) as Recipient[];
  changed[0].receives = `${changed[0].receives}, and your network address`;
  assert.notEqual(computeBase(changed), d.version);
});

test('ruling 2: the statement\'s origin is getBaseUrl(request) itself, under each of its three reachable branches', async () => {
  const { getBaseUrl } = (await import('../device-flow.ts')) as { getBaseUrl: (request?: Request) => string };
  const origin = need<(request: Request) => string>('instanceOrigin');
  const request = new Request('https://preview-456.fixture.example/api/query-notebook', { method: 'POST' });
  const saved = { APP_HOST: process.env.APP_HOST, NEXTAUTH_URL: process.env.NEXTAUTH_URL };
  try {
    for (const env of [{ APP_HOST: 'https://app.fixture.example/', NEXTAUTH_URL: 'https://auth.fixture.example' }, { NEXTAUTH_URL: 'https://auth.fixture.example///' }, {}]) {
      delete process.env.APP_HOST;
      delete process.env.NEXTAUTH_URL;
      Object.assign(process.env, env);
      assert.equal(origin(request), getBaseUrl(request), `under ${JSON.stringify(env)}`);
    }
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
