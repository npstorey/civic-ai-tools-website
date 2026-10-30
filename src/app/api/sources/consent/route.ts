import { getServerSession } from 'next-auth';
import { CIVIC_MANIFEST } from '@typedstandards/civic-typed-router';
import { authOptions } from '@/lib/auth';
import { buildFlowsStatement, statementHash, type FlowsStatement } from '@/lib/flows/statement';
import { deleteConsentRow, readConsentRow, writeConsentRow } from '@/lib/sources/consent-store';
import {
  classifyFlowsChange,
  clearConsentCookieHeader,
  consentCookieHeader,
  consentDate,
  cookieConsentInForce,
  encodeConsentCookie,
  isSecureRequest,
  isSourceState,
  noticesOf,
  readConsentCookie,
  reaskOf,
  type Reask,
  type SourceState,
} from '@/lib/sources/consent';
import { errorLogFacts } from '@/lib/streaming';

/**
 * /api/sources/consent — the reader's consent to send a question onward
 * (R6 W2 and W3, #632 D2, D3, D4, D12; design §4.4).
 *
 *   GET     the consent in force: `{ inForce, store, flowsVersion, defaults,
 *           states?, consentedAt?, updatedAt?, consentedFlowsVersion?,
 *           consentedBaseVersion?, consentedFlowsDate?, notices?, reask?,
 *           accounts }`. `consentedBaseVersion` is the base version of the
 *           statement the consent refers to (S3): the stored statement's for
 *           a row, the current statement's for a cookie in force. `accounts`
 *           says whether this instance keeps consents on accounts (a
 *           database), so a surface says "on your account" only where true. `defaults` are the
 *           states a first consent gives (each configured source's manifest
 *           `consentDefault`, D6). For a row, `notices` are the changes since
 *           the statement it holds that ask nothing (D2 = A). Sets no cookie.
 *           `keptFromCookie: true` on the one read that kept a consent given
 *           signed out on the account (below); absent on every other read.
 *   PUT     `{ states: { <source id>: 'on' | 'ask-first' | 'off' }, flowsVersion }`
 *           stores the states for the sources this instance configures,
 *           against the flows statement the surface was shown. 400 names any
 *           id this instance does not configure (flag 3: the only boundary
 *           that accepts source ids); 409 when `flowsVersion` is not the
 *           statement in force, so the surface reads it again.
 *   PATCH   `{ flowsVersion }` dismisses the notices of a row in force: the
 *           row keeps its states and now holds the statement in force, so the
 *           same change is not told again. Nothing is asked (D2 = A).
 *   DELETE  revokes: the next question is asked for consent again.
 *
 * THE STORE is chosen by the session's `dbId` (D12 = A): with one, the row in
 * `source_consents`; without one, signed in or not, the session cookie. Only
 * PUT and DELETE without a `dbId` set the cookie, and nothing else in this
 * codebase does. The cookie is `Secure` when the request reached the site
 * over https (`isSecureRequest`), on the write and the revoke alike.
 *
 * WHY A READ WRITES (R9 P4, #662; D5 = A of the UX pass). A reader who
 * answered the card signed out and then signed in has a session with a `dbId`
 * and no row, so the row store alone would ask them again for a choice they
 * have already made. So the first GET for such a session keeps the consent:
 * when the request carries a consent cookie in force (`cookieConsentInForce`,
 * the version check every cookie meets), the cookie's states are written to
 * the account's row in the shape PUT writes, and the answer is the row's,
 * with `keptFromCookie: true`. That GET is the first place that holds both
 * the session and the request's cookies (the sign-in callbacks in `auth.ts`
 * see no request cookies). A stale cookie writes nothing and is answered as
 * no consent, as before; a session with a row never reads the cookie; the
 * cookie itself is left as it is; a failed write is answered as no consent.
 */

interface Session { user?: { id?: string; dbId?: string } | null }

const json = (body: unknown, status: number, setCookie?: string) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(setCookie ? { 'Set-Cookie': setCookie } : {}) },
  });

/** Whether this instance keeps consents on accounts at all: a session carries a `dbId` only with a database (`auth.ts`). */
const accounts = () => Boolean(process.env.DATABASE_URL);

async function current(): Promise<{ statement: FlowsStatement; hash: string; configured: string[]; defaults: Record<string, SourceState> }> {
  const statement = await buildFlowsStatement();
  const configured = statement.sources.map((s) => s.sourceId);
  const defaults = Object.fromEntries(
    configured.map((id) => [id, (CIVIC_MANIFEST.find((e) => e.sourceId === id)?.consentDefault ?? 'ask-first') as SourceState]),
  );
  return { statement, hash: statementHash(statement), configured, defaults };
}

async function sessionOf(): Promise<Session | null> {
  return (await getServerSession(authOptions)) as Session | null;
}

export async function GET(request: Request): Promise<Response> {
  const session = await sessionOf();
  const { statement, hash, defaults } = await current();
  const dbId = session?.user?.dbId;
  if (dbId) {
    let row = await readConsentRow(dbId);
    // No row: keep a consent given signed out on the account (R9 P4; the header says why a read writes).
    const kept = !row && (await keepCookieConsent(request, dbId, statement, hash));
    if (kept) row = await readConsentRow(dbId);
    if (!row) return json({ inForce: false, store: 'row', flowsVersion: hash, defaults, accounts: accounts() }, 200);
    const reask = reaskOf(classifyFlowsChange(row.flowsStatement, statement));
    const inForce = !reask.base && reask.sources.length === 0;
    return json({
      inForce,
      store: 'row',
      flowsVersion: hash,
      defaults,
      accounts: accounts(),
      states: row.states,
      consentedAt: row.consentedAt,
      updatedAt: row.updatedAt,
      consentedFlowsVersion: row.flowsHash,
      consentedBaseVersion: row.flowsStatement.version,
      consentedFlowsDate: row.flowsStatement.date,
      notices: inForce ? noticesOf(row.flowsStatement, statement) : [],
      ...(inForce ? {} : { reask }),
      ...(kept ? { keptFromCookie: true } : {}),
    }, 200);
  }
  const cookie = readConsentCookie(request);
  if (!cookie) return json({ inForce: false, store: 'cookie', flowsVersion: hash, defaults, accounts: accounts() }, 200);
  const verdict = cookieConsentInForce(cookie, statement);
  const states = Object.fromEntries(Object.entries(cookie.states).map(([id, s]) => [id, { state: s.state, since: s.since }]));
  return json({
    inForce: verdict.inForce,
    store: 'cookie',
    flowsVersion: hash,
    defaults,
    accounts: accounts(),
    states,
    ...(verdict.inForce ? { consentedFlowsVersion: hash, consentedBaseVersion: statement.version, consentedFlowsDate: statement.date } : { reask: verdict.reask as Reask }),
  }, 200);
}

/**
 * Write the request's consent cookie into the account's row, when it is in
 * force against `statement`: each configured source's `{ state, since }`, as
 * PUT stores it (a source this instance does not configure is dropped, as PUT
 * refuses one), with the statement's hash and the statement. True when the
 * row was written; false for no cookie, a stale one, or a failed write, so
 * the read is answered as it was before this existed. The cookie is not
 * touched.
 */
async function keepCookieConsent(request: Request, dbId: string, statement: FlowsStatement, hash: string): Promise<boolean> {
  const cookie = readConsentCookie(request);
  if (!cookie || !cookieConsentInForce(cookie, statement).inForce) return false;
  const configured = new Set(statement.sources.map((s) => s.sourceId));
  const states = Object.fromEntries(
    Object.entries(cookie.states)
      .filter(([id]) => configured.has(id))
      .map(([id, s]) => [id, { state: s.state, since: s.since }]),
  );
  try {
    await writeConsentRow(dbId, { states, flowsHash: hash, flowsStatement: statement });
    return true;
  } catch (err) {
    // Bounded (#503 WF): the store's error message carries the bound parameters, the account key and the states among them.
    console.error('[api/sources/consent] keeping a cookie consent on the account failed; answered as no consent', errorLogFacts(err));
    return false;
  }
}

export async function PUT(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'The consent could not be read: send JSON with the states and the flows version shown.', code: 'invalid_consent' }, 400);
  }
  const { states, flowsVersion } = (body ?? {}) as { states?: unknown; flowsVersion?: unknown };
  if (!states || typeof states !== 'object' || Array.isArray(states) || typeof flowsVersion !== 'string') {
    return json({ error: 'The consent needs a state for each source and the flows version it was shown.', code: 'invalid_consent' }, 400);
  }
  const entries = Object.entries(states as Record<string, unknown>);
  if (entries.some(([, state]) => !isSourceState(state))) {
    return json({ error: 'Each source must be On, Ask first or Off.', code: 'invalid_consent' }, 400);
  }
  const { statement, hash, configured } = await current();
  const unknown = entries.map(([id]) => id).filter((id) => !configured.includes(id));
  if (unknown.length > 0) {
    return json({
      error: `This site does not offer ${unknown.map((id) => `"${id}"`).join(', ')}, so no consent can be stored for it. It offers ${configured.map((id) => `"${id}"`).join(', ')}.`,
      code: 'unknown_source',
      unknown,
    }, 400);
  }
  if (flowsVersion !== hash) {
    return json({
      error: 'Where a question goes on this site has changed since this was shown. Read it again before you answer.',
      code: 'flows_version_stale',
      flowsVersion: hash,
    }, 409);
  }

  const session = await sessionOf();
  const dbId = session?.user?.dbId;
  const today = consentDate();
  const given = entries as Array<[string, SourceState]>;

  if (dbId) {
    // A state the reader did not change keeps the date it was first given.
    const prior = (await readConsentRow(dbId))?.states ?? {};
    const stored = Object.fromEntries(given.map(([id, state]) => [id, { state, since: prior[id]?.state === state ? prior[id].since : today }]));
    await writeConsentRow(dbId, { states: stored, flowsHash: hash, flowsStatement: statement });
    return json({ inForce: true, store: 'row', flowsVersion: hash, states: stored }, 200);
  }

  const prior = readConsentCookie(request)?.states ?? {};
  const version = (id: string) => statement.sources.find((s) => s.sourceId === id)!.version;
  const cookieStates = Object.fromEntries(given.map(([id, state]) => [id, { state, since: prior[id]?.state === state ? prior[id].since : today, version: version(id) }]));
  const value = encodeConsentCookie({ v: 1, flows: statement.version, states: cookieStates });
  const states2 = Object.fromEntries(given.map(([id]) => [id, { state: cookieStates[id].state, since: cookieStates[id].since }]));
  return json({ inForce: true, store: 'cookie', flowsVersion: hash, states: states2 }, 200, consentCookieHeader(value, isSecureRequest(request)));
}

export async function PATCH(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const { flowsVersion } = (body ?? {}) as { flowsVersion?: unknown };
  const session = await sessionOf();
  const dbId = session?.user?.dbId;
  if (!dbId) return json({ error: 'Only a consent kept on an account has notices to dismiss.', code: 'no_notices' }, 400);
  const { statement, hash } = await current();
  if (flowsVersion !== hash) return json({ error: 'Where a question goes on this site has changed since this was shown. Read it again.', code: 'flows_version_stale', flowsVersion: hash }, 409);
  const row = await readConsentRow(dbId);
  if (!row) return json({ error: 'There is no consent to dismiss notices for.', code: 'no_notices' }, 400);
  const reask = reaskOf(classifyFlowsChange(row.flowsStatement, statement));
  if (reask.base || reask.sources.length > 0) {
    return json({ error: 'This change needs your answer again, so it cannot be dismissed.', code: 'consent_required', flowsVersion: hash, reask }, 409);
  }
  await writeConsentRow(dbId, { states: row.states, flowsHash: hash, flowsStatement: statement });
  return json({ inForce: true, store: 'row', flowsVersion: hash, states: row.states, notices: [] }, 200);
}

export async function DELETE(request: Request): Promise<Response> {
  const session = await sessionOf();
  const dbId = session?.user?.dbId;
  if (dbId) {
    await deleteConsentRow(dbId);
    return json({ inForce: false, store: 'row' }, 200);
  }
  return json({ inForce: false, store: 'cookie' }, 200, clearConsentCookieHeader(isSecureRequest(request)));
}
