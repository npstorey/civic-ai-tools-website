/**
 * The usage counter (#632 W5, D9): how many questions the site answered, per
 * day and per kind of run, as rows of `usage_counts`.
 *
 * WHAT IS COUNTED. A run: one question a query route started answering.
 * A request refused before its run (validation, configuration, consent, the
 * rate limit) is not counted. Each run adds one to the row keyed on eight
 * columns, every one from a closed set:
 *   day              the UTC date when the run ended
 *   environment      `USAGE_ENVIRONMENTS`: `hostingEnvironment()` when it is
 *                    `production`, `preview` or `development`, `local` off
 *                    the platform, `other` for anything else the platform sets
 *   surface          `USAGE_SURFACES`: the route
 *   signed_in        whether the session carries an account id
 *   model            the model's declared id, which the route resolved from
 *                    this instance's catalog (an id it does not offer is refused)
 *   outcome          `complete` or `error`
 *   sources_offered  the source ids whose reason offers them
 *                    (`isOfferedReason`: configured or selected), sorted and
 *                    comma-joined, '' for none
 *   sources_used     the ids with at least one call that answered, in the same
 *                    form; a refused or failed call is not use
 * No account, no network address and no question text reaches a column: the
 * row is built from the session's presence, constants and manifest ids alone.
 *
 * WHEN AND HOW IT IS WRITTEN. A route calls `startUsageCount()` when its run
 * starts, while the request is open; that registers, with Next's `after()`, a
 * promise that settles once the write has. The route calls `end()` when the
 * run has ended and the response is finished: after `writer.close()` on the two
 * streaming routes, whether the close resolved or rejected, and after the JSON
 * response is built on `/api/compare`. Only then does the write start, so it
 * can neither delay nor change what the reader receives.
 *   - The registered promise never rejects: Next logs a rejected one raw, and
 *     a failed write is logged here as a class only (`errorLogFacts`).
 *   - The write is bounded (`USAGE_WRITE_TIMEOUT_MS`), so an unreachable
 *     database cannot hold the function to its maximum duration.
 *   - Outside a request scope (`after()` throws, E468: a test calling a
 *     handler directly), the write still runs, unregistered, and one
 *     class-only line says so.
 *
 * THE ONE WRITER. Nothing else names the table outside tests, and this module
 * only inserts (`one-writer.test.ts`). The monthly file and any read are later
 * work.
 */
import { after } from 'next/server';
import { sql } from 'drizzle-orm';
import { isOfferedReason, type OfferedReason } from '@typedstandards/civic-typed-router';
import { db } from '../db/index.ts';
import { usageCounts } from '../db/schema.ts';
import { hostingEnvironment } from '../hosting-environment.ts';
import { errorLogFacts } from '../streaming.ts';

/** How long a write may take before it is abandoned and logged. */
export const USAGE_WRITE_TIMEOUT_MS = 10_000;

/** The `surface` column's values: the route that ran the question. */
export const USAGE_SURFACES = ['compare-stream', 'query-notebook', 'compare'] as const;
export type UsageSurface = (typeof USAGE_SURFACES)[number];

/** The `environment` column's values. */
export const USAGE_ENVIRONMENTS = ['production', 'preview', 'development', 'local', 'other'] as const;
export type UsageEnvironment = (typeof USAGE_ENVIRONMENTS)[number];

/** The `outcome` column's values. */
export type UsageOutcome = 'complete' | 'error';

/** What a route holds when its run ends. */
export interface UsageRunInput {
  surface: UsageSurface;
  /** The session as `getServerSession` returned it; only the account id's presence is read. */
  session: unknown;
  model: { declared: string };
  outcome: UsageOutcome;
  /** Each source's offered-reason, as the composition states it. */
  sourcesOffered: ReadonlyArray<{ sourceId: string; reason: unknown }>;
  /** The run's tool calls; only the name and whether it failed are read. */
  toolCalls: ReadonlyArray<{ name: string; failed?: boolean }>;
  /** The route's source resolver: the source a tool name is routed to. */
  resolveSource: (toolName: string) => string | undefined;
  endedAt: Date;
}

/** The `environment` column: the hosting environment, through the closed set. */
export function usageEnvironment(): UsageEnvironment {
  const environment = hostingEnvironment();
  return (USAGE_ENVIRONMENTS as readonly string[]).includes(environment) ? (environment as UsageEnvironment) : 'other';
}

/** Ids sorted and comma-joined, each once; '' for none. */
function idList(ids: Iterable<string>): string {
  return [...new Set(ids)].sort().join(',');
}

/** A stored reason is `unknown`; only a string can be one the router offers. */
function offers(reason: unknown): boolean {
  return typeof reason === 'string' && isOfferedReason(reason as OfferedReason);
}

/** The row one run adds: the eight key columns and a count of one. */
export function usageRow(input: UsageRunInput) {
  const user = (input.session as { user?: { id?: unknown } } | null | undefined)?.user;
  const used: string[] = [];
  for (const call of input.toolCalls) {
    if (call.failed === true) continue;
    const source = input.resolveSource(call.name);
    if (typeof source === 'string' && source.length > 0) used.push(source);
  }
  return {
    day: input.endedAt.toISOString().slice(0, 10),
    environment: usageEnvironment(),
    surface: input.surface,
    signedIn: typeof user?.id === 'string' && user.id.length > 0,
    model: input.model.declared,
    outcome: input.outcome,
    sourcesOffered: idList(input.sourcesOffered.filter((entry) => offers(entry.reason)).map((entry) => entry.sourceId)),
    sourcesUsed: idList(used),
    count: 1,
  };
}

export type UsageRow = ReturnType<typeof usageRow>;

/** A run's count: registered when the run starts, written when it ends. */
export interface UsageCount {
  /** Start the write. Idempotent; never throws. */
  end(input: Omit<UsageRunInput, 'endedAt'>): void;
}

class UsageWriteTimeoutError extends Error {
  constructor() {
    super('the usage write did not settle within its bound');
    this.name = 'UsageWriteTimeoutError';
  }
}

/** Register the run's count with `after()`; call `end()` once the run's response has ended. */
export function startUsageCount(): UsageCount {
  let release: () => void = () => {};
  const settled = new Promise<void>((resolve) => { release = resolve; });
  let unregistered: ReturnType<typeof errorLogFacts> | null = null;
  try {
    after(settled);
  } catch (error) {
    // E468 outside a request scope. The write still runs; it is only not
    // held open for, which a test process does not need.
    unregistered = errorLogFacts(error);
  }
  let ended = false;
  return {
    end(input) {
      if (ended) return;
      ended = true;
      if (unregistered) console.error('[usage] the write runs unregistered: after() has no request scope here', unregistered);
      let row: UsageRow;
      try {
        row = usageRow({ ...input, endedAt: new Date() });
      } catch (error) {
        console.error('[usage] the row could not be built', errorLogFacts(error));
        release();
        return;
      }
      void writeRow(row).then(release, release);
    },
  };
}

/** Insert the row, or add one to its count; bounded, and never rejects. */
async function writeRow(row: UsageRow): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new UsageWriteTimeoutError()), USAGE_WRITE_TIMEOUT_MS);
    // A pending write never holds a process open on its own.
    timer.unref?.();
  });
  try {
    await Promise.race([
      // Inside a function, so a client that throws on first use (no
      // DATABASE_URL) rejects here rather than throwing past the race.
      (async () => {
        await db
          .insert(usageCounts)
          .values(row)
          .onConflictDoUpdate({
            target: [
              usageCounts.day,
              usageCounts.environment,
              usageCounts.surface,
              usageCounts.signedIn,
              usageCounts.model,
              usageCounts.outcome,
              usageCounts.sourcesOffered,
              usageCounts.sourcesUsed,
            ],
            set: { count: sql`${usageCounts.count} + 1` },
          });
      })(),
      bound,
    ]);
  } catch (error) {
    console.error('[usage] write failed', errorLogFacts(error));
  } finally {
    clearTimeout(timer);
  }
}
