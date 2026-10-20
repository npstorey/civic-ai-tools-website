/**
 * The hosted source's sandbox snapshot, as two facts (R6 W3, #632): this
 * site's own setting, and Vercel's own statement, quoted with its page and
 * the date it was read. The flows statement (`./statement.ts`) and the
 * privacy page (`../privacy-facts.ts`) both state them; they live here, apart
 * from both, because each of those modules imports the other.
 */

/** Vercel's page on sandbox snapshots, which states how long a snapshot is kept. */
export const VERCEL_SANDBOX_SNAPSHOTS = 'https://vercel.com/docs/vercel-sandbox/concepts/snapshots';

/** The date that page was read, UTC. */
export const SANDBOX_SNAPSHOTS_READ_DATE = '2026-10-20';

/** Its sentence, as read (the page's text with its markup stripped). */
export const SANDBOX_SNAPSHOTS_SENTENCE = 'Snapshots expire 30 days after their last use by default.';

/**
 * How long this site sets a hosted source's snapshot to live, in days: the
 * value of `SNAPSHOT_EXPIRATION_MS` in `src/lib/mcp/hosting/lifecycle.ts`
 * (`:96`, used at `:328`), which that module does not export. Stated, not
 * imported: `statement-wording.test.ts` reads the figure from that file's
 * text and fails when the two differ.
 */
export const HOSTED_SNAPSHOT_EXPIRATION_DAYS = 30;
