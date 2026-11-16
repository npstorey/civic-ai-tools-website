/**
 * The reader's picks on the server (S3-B W1, npstorey/civic-ai-tools#318; G0-2 = A, G0-4 = A, anchor B8 and B9).
 *
 * "Only the ones I pick": the picks travel in the question's request body, as `picks`, and can only narrow the run.
 * Nothing about them is stored. ONE function computes a run's set, and every route that takes a question reads it
 * (`/api/compare-stream`, `/api/query-notebook`, `/api/compare`):
 *
 *   - THE BODY (`picksFromBody`, the ORCH's A8). No `picks` key is an Auto question, and the route runs exactly as
 *     before W1. A `picks` key that is not an array, or an empty array, is a picked question with nothing picked.
 *     Entries that are not strings, repeats and ids the manifest does not hold are dropped.
 *   - THE SET (`pickedRunOf`). The surviving picks are the picks the instance configures and the reader has not set
 *     Off, in manifest order. A pick can never add a source: an unconfigured id, an Off source, an unknown id or a
 *     repeat adds nothing. In loop the run lists exactly the surviving picks, rule `reader-picked` version `1`
 *     (`READER_PICKED_RULE`), and lists the same set it can search, so it is offered no `find_source` (G0-4 = A).
 *     All-sources (the ORCH's A7), the selection is narrowed to the surviving picks that are On, and no
 *     `considered` is recorded, as on any all-sources run.
 *   - THE REFUSAL. A run that could use none of its picks is refused before the model or any source is called, with
 *     `no_picks_usable` (S10, `friendlyStreamError`): no pick survived, or none that survived is On and the run
 *     cannot pause to ask about an Ask-first one (the JSON route, which holds no pause; an all-sources run; a site
 *     without the decision store). The ORCH's A6 and the words file's NOTE 5.
 *   - THE REASONS. An allowed source the reader did not pick is recorded `not-selected`, never `not-consented`
 *     (anchor B8), through `recordSourcesOffered`'s picked list.
 *
 * Pure: it reads no request, no store and no environment.
 */
import { CIVIC_MANIFEST, civicRouter } from '@typedstandards/civic-typed-router';
import type { McpRegistryEnv } from '../mcp/registry.ts';
import { recordSourcesOffered } from './consent.ts';

/** What a question's body says about its sources: Auto, or the reader's picks as sent. */
export type RequestPicks = { kind: 'auto' } | { kind: 'picked'; ids: string[] };

/** The manifest's source ids, the only ids a pick may name. */
const MANIFEST_IDS: readonly string[] = CIVIC_MANIFEST.map((entry) => entry.sourceId);

/** Read `picks` from a parsed request body (A8). */
export function picksFromBody(body: unknown): RequestPicks {
  if (body === null || typeof body !== 'object' || !Object.hasOwn(body, 'picks')) return { kind: 'auto' };
  const value = (body as { picks?: unknown }).picks;
  if (!Array.isArray(value)) return { kind: 'picked', ids: [] };
  const ids: string[] = [];
  for (const id of value) {
    if (typeof id === 'string' && MANIFEST_IDS.includes(id) && !ids.includes(id)) ids.push(id);
  }
  return { kind: 'picked', ids };
}

/** What a route's consent decision gives the picks (`consentInForce`'s `ok` answer). */
export interface PicksConsent {
  /** False while the gate is dormant: every configured source reads On. */
  enforced: boolean;
  /** The stored states, by source id. */
  states: Readonly<Record<string, string>>;
}

/** A picked run's set, as every route reads it. */
export interface PickedRun {
  /** The picks the instance configures and the reader has not set Off, in manifest order: the listed set in loop. */
  survivors: string[];
  /** The surviving picks that are On: the selection the composition and the record's reasons are given. */
  selection: string[];
  /** False when the run could use none of its picks: refused, `no_picks_usable`, before anything is sent. */
  usable: boolean;
  /** The record's reasons: the router's, with an allowed source the reader did not pick kept `not-selected`. */
  recordReasons: <T extends { sourceId: string; alias: string; reason: string }>(offered: readonly T[]) => Array<{ sourceId: string; alias: string; reason: string }>;
}

/**
 * The run's set from the reader's picks: the one server function (task 7). `canPause` is whether this run can ask
 * the reader about an Ask-first source (`canAsk` on a route that holds a pause and routes in loop); false on
 * `/api/compare` and on every all-sources run.
 */
export function pickedRunOf(picks: readonly string[], configured: McpRegistryEnv, consent: PicksConsent, canPause: boolean): PickedRun {
  const stateOf = (id: string): string => {
    if (!consent.enforced) return 'on';
    return Object.hasOwn(consent.states, id) ? consent.states[id] : 'ask-first';
  };
  const survivors = civicRouter.offeredSkillSources(configured).filter((id) => picks.includes(id) && stateOf(id) !== 'off');
  const selection = survivors.filter((id) => stateOf(id) === 'on');
  const usable = selection.length > 0 || (canPause && survivors.length > 0);
  return {
    survivors,
    selection,
    usable,
    recordReasons: (offered) => recordSourcesOffered(offered, consent.enforced ? consent.states : {}, survivors),
  };
}
