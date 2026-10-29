/**
 * The just-in-time consent pause (#644 W2; design §1.6; D4 = A): a load of a
 * source the reader set to Ask first stops the answer and asks the reader, on
 * the server's terms.
 *
 * THE PAUSE (`createConsentPause`), handed to the in-loop load step by the
 * two streaming routes only (`/api/compare-stream`, `/api/query-notebook`):
 *   1. it writes `consent-decision:<key>` to the shared key-value store, the
 *      key 128 random bits, the entry the source id and, under a `dbId`, a
 *      reader code (below), expiring after `DECISION_ENTRY_TTL_SECONDS`;
 *   2. only once that write has succeeded does it report the pause (the
 *      loop's `consent_pause` event, with the key, the source's entry in the
 *      flows statement, its hosts, the links, `expiresAt` and `holds: true`),
 *      so no surface shows buttons whose answer would find no entry;
 *   3. it reads the entry every `CONSENT_PAUSE_POLL_MS` for at most
 *      `CONSENT_PAUSE_BOUND_MS`, and answers `allow`, `not-now` or
 *      `no-answer`.
 * The event also carries `entryExpiresAt`, the hold's start plus the entry's
 * life (R9 P1, #669 D2): the card keeps its buttons until then, since an
 * answer the entry still takes moves the source On for later questions.
 *
 * A READER WHO IS GONE (R9 P1, #668). When the reader's stream is dropped
 * (the request's signal aborts, or the response stream is cancelled:
 * `readerGone`), the hold ends `no-answer` at its next check rather than
 * polling to its bound for nobody, so an answer posted afterwards cannot
 * send the run on to the source. The entry is left as it is, its expiry
 * unmoved, for the reader's card; the bound, the entry's life and every value
 * the loop records are the same as for any hold that ends unanswered.
 * A run holds at most `CONSENT_PAUSE_RUN_BUDGET_MS` in all; the load step
 * holds once per source. Nothing here contacts a source or wakes a sandbox.
 *
 * NO STORE IS NOT A MEMORY STORE (D4 v). With `KV_REST_API_URL` or
 * `KV_REST_API_TOKEN` unset, a write that throws or is refused, or the run's
 * budget spent, the pause does not hold: it reports `holds: false` with no key
 * and answers `no-answer` at once. A failed read ends a hold as `no-answer`.
 * No store failure leaves this module as a throw (ruling A): the loop records
 * a throw out of a load as `unavailable`, which is not what happened.
 *
 * THE STORE is `@vercel/kv`'s client, the one the rate limiter uses
 * (`../rate-limit.ts`), on the same pair; `decision-sole-store-client.test.ts`
 * holds that nothing else reaches the store. Unlike the limiter, it never
 * falls back to a process-local map: a pause one invocation writes and
 * another answers cannot meet in one process's memory.
 *
 * THE READER CODE [D]. Under a session with a `dbId` (a signed-in reader on
 * an instance with a database) the entry holds HMAC-SHA256 of the `dbId`,
 * keyed by `RATE_LIMIT_SECRET` under this pause's own fixed label, never the
 * limiter's; the raw `dbId` is never stored. The decision route refuses a key
 * whose code is not the requester's (403). With no `dbId` the key is the only
 * capability, as for an anonymous reader. The secret has no default, and both
 * streaming routes refuse without it, so a run that reaches a pause has it.
 *
 * THE DECISION (`answerConsentDecision`, `POST /api/sources/consent/decision`).
 * A key minted under another account is refused (403) before a decided key
 * (409), so a stranger learns nothing from the status. The decision is
 * written first, and only once it is written does `allow` move that one
 * source to On (fix round 2, item 2): a write that fails or finds no entry
 * leaves the consent as it was. The move goes through R6's store, from its
 * exported pieces, as `PUT /api/sources/consent` composes them: the row (kept
 * with its `flowsHash` and `flowsStatement`) for a session with a `dbId`,
 * else the cookie (kept with its `flows` and every other source's entry). A
 * move that fails after the decision was written answers 200 with
 * `moved: false`: the run goes on with the source, and the consent did not
 * change. `not-now` moves nothing. The decision is written with `XX KEEPTTL`:
 * a plain `SET` would clear the entry's expiry, and `KEEPTTL` alone would
 * re-create an entry that had expired, so neither the privacy page's "expire
 * 10 minutes after it is made" nor a 404 for an expired key would hold.
 *
 * NONE OF IT IS SIGNED. The key, the reader code and the decision reach no
 * span and no record (the rider); only the load's outcome does, as before.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { kv } from '@vercel/kv';
import { CIVIC_MANIFEST } from '@typedstandards/civic-typed-router';
import { getMissingRateLimitSecretError, RATE_LIMIT_SECRET_VARIABLE } from '../rate-limit.ts';
import { buildFlowsStatement, type FlowsLinks, type FlowsSource, type FlowsStatement } from '../flows/statement.ts';
import { hostingVariantInForce, type McpRegistryEnv } from '../mcp/registry.ts';
import { readConsentRow, writeConsentRow } from './consent-store.ts';
import { consentCookieHeader, consentDate, encodeConsentCookie, isSecureRequest, readConsentCookie } from './consent.ts';
import type { ConsentPause, PauseDecision } from '../mcp/routing-mode.ts';
import type { ConsentPausePayload } from '../streaming.ts';

// --- The bounds --------------------------------------------------------------------

/** How long an entry lives in the store, in seconds: the privacy page's "10 minutes". */
export const DECISION_ENTRY_TTL_SECONDS = 600;

/** How long one load holds for an answer. */
export const CONSENT_PAUSE_BOUND_MS = 60_000;

/** How often a hold reads the store. */
export const CONSENT_PAUSE_POLL_MS = 500;

/** How long one run holds in all. */
export const CONSENT_PAUSE_RUN_BUDGET_MS = 120_000;

/** The store key's prefix; the key itself follows. */
export const DECISION_KEY_PREFIX = 'consent-decision:';

/** The reader code's fixed label: this pause's own, never the rate limiter's. */
const READER_CODE_LABEL = 'civic-consent-pause-reader-v1';

/** A decision key: 128 random bits, lowercase hex. */
const KEY_SHAPE = /^[0-9a-f]{32}$/;

// --- The store ---------------------------------------------------------------------

/** What the pause writes, and the decision route adds `decision` to. */
export interface DecisionEntry {
  sourceId: string;
  /** The reader code, only under a `dbId`. */
  reader?: string;
  decision?: 'allow' | 'not-now';
}

/** The two commands the pause and the decision route send. */
export interface DecisionStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: DecisionEntry, options: { ex: number; nx: true } | { xx: true; keepTtl: true }): Promise<unknown>;
}

/** The store, on the pair the rate limiter reads, or null when either is unset. Never a memory store. */
export function decisionStoreFromEnv(): DecisionStore | null {
  return process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN ? kv : null;
}

function isEntry(value: unknown): value is DecisionEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.sourceId === 'string'
    && (entry.reader === undefined || typeof entry.reader === 'string')
    && (entry.decision === undefined || entry.decision === 'allow' || entry.decision === 'not-now');
}

// --- The key and the reader code -----------------------------------------------------

/** A new decision key. */
export function newDecisionKey(): string {
  return randomBytes(16).toString('hex');
}

/** `RATE_LIMIT_SECRET`, trimmed, or undefined when unset, empty or blank. Never logged. */
function readPauseSecret(): string | undefined {
  const raw = process.env.RATE_LIMIT_SECRET;
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed.length > 0 ? trimmed : undefined;
}

/** The reader code an entry holds under a `dbId`: HMAC-SHA256 under this pause's own label, lowercase hex. */
export function readerCode(dbId: string, secret: string): string {
  return createHmac('sha256', secret).update(`${READER_CODE_LABEL}:${dbId}`, 'utf8').digest('hex');
}

function sameCode(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

// --- The pause ------------------------------------------------------------------------

/** What a pause shows of a source: its statement entry, the hosts its variant may reach, and the statement's links. */
export function pauseFacts(
  statement: Pick<FlowsStatement, 'sources' | 'links'>,
  configured: McpRegistryEnv,
  sourceId: string,
): { source: FlowsSource; outbound: string[]; links: FlowsLinks } | null {
  const source = statement.sources.find((candidate) => candidate.sourceId === sourceId);
  if (!source) return null;
  const entry = CIVIC_MANIFEST.find((candidate) => candidate.sourceId === sourceId);
  const variant = entry ? hostingVariantInForce(entry, configured) : undefined;
  const outbound = variant?.kind === 'npm-package' ? [...variant.outbound] : [];
  return { source, outbound, links: statement.links };
}

export interface ConsentPauseInput {
  /** `decisionStoreFromEnv()`; null when the instance has none. */
  store: DecisionStore | null;
  /** The flows statement in force for the run: the source's entry and the links come from it. */
  statement: Pick<FlowsStatement, 'sources' | 'links'>;
  configured: McpRegistryEnv;
  /** The session's `dbId`, when it has one. */
  dbId?: string;
  /** For tests: the secret; defaults to `RATE_LIMIT_SECRET`. */
  secret?: string;
  /** For tests: the clock and the wait between reads. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  newKey?: () => string;
  /** The reader's stream is gone (`readerGone`): a hold ends `no-answer` at its next check. */
  gone?: AbortSignal;
}

/**
 * Whether the reader of a streaming response is still there: `signal` aborts
 * when the request's own signal does, or when the response stream is
 * cancelled (its writer's `closed` rejects). `watch` is called once the
 * route has its writer. Nothing here writes, reads the store or ends the run.
 */
export function readerGone(request: Request): { signal: AbortSignal; watch: (writer: WritableStreamDefaultWriter<unknown>) => void } {
  const gone = new AbortController();
  const end = () => { if (!gone.signal.aborted) gone.abort(); };
  const own = request.signal as AbortSignal | undefined;
  if (own?.aborted) end();
  else own?.addEventListener('abort', end, { once: true });
  return {
    signal: gone.signal,
    // A close of our own resolves `closed`; only a cancelled stream rejects it.
    watch: (writer) => { writer.closed.catch(end); },
  };
}

/** One run's pause: at most one hold per call to `ask`, and `CONSENT_PAUSE_RUN_BUDGET_MS` of holds in all. */
export function createConsentPause(input: ConsentPauseInput): ConsentPause {
  const now = input.now ?? (() => Date.now());
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const newKey = input.newKey ?? newDecisionKey;
  const gone = input.gone;
  // The wait between reads, cut short when the reader goes.
  const pauseFor = (ms: number) => {
    if (!gone) return sleep(ms);
    if (gone.aborted) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = () => { gone.removeEventListener('abort', done); resolve(); };
      gone.addEventListener('abort', done, { once: true });
      void sleep(ms).then(done);
    });
  };
  const secret = input.secret ?? readPauseSecret();
  let spentMs = 0;

  return {
    async ask(sourceId, report): Promise<PauseDecision> {
      const facts = pauseFacts(input.statement, input.configured, sourceId);
      // The reader's stream may already be gone; that is not the pause's failure.
      const send = (payload: ConsentPausePayload) => {
        try {
          report(payload);
        } catch {
          /* nobody is listening */
        }
      };
      const notHeld = (): PauseDecision => {
        if (facts) send({ ...facts, expiresAt: new Date(now()).toISOString(), holds: false });
        return 'no-answer';
      };
      const budget = CONSENT_PAUSE_RUN_BUDGET_MS - spentMs;
      if (!facts || !input.store || budget <= 0) return notHeld();
      // Nobody is left to answer: no entry is written for them.
      if (gone?.aborted) return notHeld();

      const key = newKey();
      const name = `${DECISION_KEY_PREFIX}${key}`;
      const entry: DecisionEntry = { sourceId, ...(input.dbId && secret ? { reader: readerCode(input.dbId, secret) } : {}) };
      try {
        if ((await input.store.set(name, entry, { ex: DECISION_ENTRY_TTL_SECONDS, nx: true })) !== 'OK') return notHeld();
      } catch {
        return notHeld();
      }

      const holdMs = Math.min(CONSENT_PAUSE_BOUND_MS, budget);
      const start = now();
      send({
        key,
        ...facts,
        expiresAt: new Date(start + holdMs).toISOString(),
        // The entry's end, from the same start (the seat's note 1); the store's own expiry is not moved.
        entryExpiresAt: new Date(start + DECISION_ENTRY_TTL_SECONDS * 1000).toISOString(),
        holds: true,
      });
      try {
        for (;;) {
          const elapsed = now() - start;
          if (elapsed >= holdMs || gone?.aborted) return 'no-answer';
          await pauseFor(Math.min(CONSENT_PAUSE_POLL_MS, holdMs - elapsed));
          if (gone?.aborted) return 'no-answer';
          let value: unknown;
          try {
            value = await input.store.get(name);
          } catch {
            return 'no-answer';
          }
          if (isEntry(value) && value.decision !== undefined) return value.decision;
        }
      } finally {
        spentMs += now() - start;
      }
    },
  };
}

/** The session fields the pause and the decision route read. */
export interface DecisionSession {
  user?: { id?: string; dbId?: string } | null;
}

/**
 * The pause a streaming route hands its in-loop run, or none while the
 * consent gate is dormant (no statement, and every source loads as On).
 */
export function streamingRoutePause(
  consent: { statement?: FlowsStatement },
  session: DecisionSession | null | undefined,
  configured: McpRegistryEnv,
  gone?: AbortSignal,
): ConsentPause | undefined {
  if (!consent.statement) return undefined;
  const dbId = session?.user?.dbId;
  return createConsentPause({ store: decisionStoreFromEnv(), statement: consent.statement, configured, ...(dbId ? { dbId } : {}), ...(gone ? { gone } : {}) });
}

// --- The decision ------------------------------------------------------------------------

const json = (body: unknown, status: number, setCookie?: string) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(setCookie ? { 'Set-Cookie': setCookie } : {}) },
  });

/**
 * Move one source to On in the requester's consent, as `PUT
 * /api/sources/consent` would write it, changing nothing else. Returns the
 * cookie to set, or undefined (a row was written, or there is nothing to
 * merge into: no row, or no cookie on the request).
 */
async function moveSourceOn(request: Request, session: DecisionSession | null | undefined, sourceId: string): Promise<string | undefined> {
  const today = consentDate();
  const dbId = session?.user?.dbId;
  if (dbId) {
    const row = await readConsentRow(dbId);
    if (!row) return undefined;
    const prior = row.states[sourceId];
    const states = { ...row.states, [sourceId]: { state: 'on' as const, since: prior?.state === 'on' ? prior.since : today } };
    await writeConsentRow(dbId, { states, flowsHash: row.flowsHash, flowsStatement: row.flowsStatement });
    return undefined;
  }
  const cookie = readConsentCookie(request);
  if (!cookie) return undefined;
  const statement = await buildFlowsStatement();
  const prior = cookie.states[sourceId];
  const version = statement.sources.find((s) => s.sourceId === sourceId)?.version ?? prior?.version;
  if (!version) return undefined;
  const states = { ...cookie.states, [sourceId]: { state: 'on' as const, since: prior?.state === 'on' ? prior.since : today, version } };
  return consentCookieHeader(encodeConsentCookie({ v: 1, flows: cookie.flows, states }), isSecureRequest(request));
}

/** `POST /api/sources/consent/decision`: `{ key, decision }`, `decision` one of `allow` and `not-now`. */
export async function answerConsentDecision(
  request: Request,
  session: DecisionSession | null | undefined,
  deps: { store?: DecisionStore | null } = {},
): Promise<Response> {
  // The streaming routes' own refusal, before any key is read [D].
  const secretError = getMissingRateLimitSecretError();
  if (secretError) {
    // The variable's name, never an error's text (errors-out-of-logs.test.ts).
    console.error(`[consent-decision] ${RATE_LIMIT_SECRET_VARIABLE} is not set; the answer was refused before any key was read`);
    return json({ error: secretError.message, code: secretError.code }, 503);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const { key, decision } = (body && typeof body === 'object' ? body : {}) as { key?: unknown; decision?: unknown };
  if (typeof key !== 'string' || (decision !== 'allow' && decision !== 'not-now')) {
    return json({ error: 'The answer could not be read: send the key and allow or not-now.', code: 'invalid_decision' }, 400);
  }
  const unknown = () => json({ error: 'This question is no longer waiting for that answer.', code: 'decision_unknown' }, 404);
  if (!KEY_SHAPE.test(key)) return unknown();
  const store = deps.store === undefined ? decisionStoreFromEnv() : deps.store;
  const unsaved = () => json({ error: 'The answer could not be saved just now.', code: 'decision_store_unavailable' }, 503);
  if (!store) return unsaved();

  const name = `${DECISION_KEY_PREFIX}${key}`;
  let entry: unknown;
  try {
    entry = await store.get(name);
  } catch {
    return unsaved();
  }
  if (!isEntry(entry)) return unknown();
  // Whose key it is, before whether it was decided: a stranger learns nothing from the status.
  if (entry.reader !== undefined) {
    const dbId = session?.user?.dbId;
    const secret = readPauseSecret();
    if (!dbId || !secret || !sameCode(readerCode(dbId, secret), entry.reader)) {
      return json({ error: 'This answer can only be given from the account that asked the question.', code: 'decision_not_yours' }, 403);
    }
  }
  if (entry.decision !== undefined) return json({ error: 'An answer was already given for this question.', code: 'decision_made' }, 409);

  // The decision first: a refused write leaves the consent as it was.
  let written: unknown;
  try {
    written = await store.set(name, { ...entry, decision }, { xx: true, keepTtl: true });
  } catch {
    return unsaved();
  }
  if (written === null) return unknown();
  if (decision !== 'allow') return json({ decision, sourceId: entry.sourceId }, 200);

  let setCookie: string | undefined;
  try {
    setCookie = await moveSourceOn(request, session, entry.sourceId);
  } catch {
    // The run polls the decision, which is saved; only the consent did not move. No error's text (errors-out-of-logs.test.ts).
    console.error('[consent-decision] the decision was saved, but the consent could not be moved');
    return json({ decision, sourceId: entry.sourceId, moved: false }, 200);
  }
  return json({ decision, sourceId: entry.sourceId }, 200, setCookie);
}
