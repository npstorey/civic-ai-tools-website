-- civic-ai-tools-website#632 W5 (D9): the usage counter, how many questions
-- the site answered, per day and per kind of run.
--
-- WHAT IT HOLDS. One row per day and combination of the eight key columns;
-- `count` is how many runs ended with that combination:
--   day              the UTC date when the run ended
--   environment      `production`, `preview`, `development`, `local` (off the
--                    hosting platform) or `other` (any other platform value)
--   surface          the route that ran the question: `compare-stream`,
--                    `query-notebook` or `compare`
--   signed_in        whether the reader was signed in
--   model            the AI model's declared id, from this instance's catalog
--   outcome          `complete` or `error`
--   sources_offered  the data sources the run was offered, ids sorted and
--                    comma-joined, '' for none
--   sources_used     the sources with at least one call that answered, in the
--                    same form
--   count            how many runs
-- Every value comes from a closed set (`src/lib/usage/count.ts`). The table
-- holds no account, no network address and no question text, and nothing in
-- the app reads it. A request refused before its run is not counted.
--
-- OWNER-RUN. Applied by hand via psql, ahead of the deploy that starts writing
-- this table. A downstream fork applies this same file through an ordinary
-- `drizzle-kit migrate`, so both paths must be safe on a database that already
-- has the table: `CREATE TABLE IF NOT EXISTS` makes the statement idempotent,
-- and the primary key is written inside it, not as a separate
-- `ALTER TABLE ... ADD CONSTRAINT` (which has no IF NOT EXISTS form and would
-- fail on a second run). `drizzle-kit generate` writes the named key inline
-- but not `IF NOT EXISTS`; that, and this header, were written by hand here and
-- should stay. The key is named `usage_counts_pkey` in the schema: drizzle's
-- default name for a key over eight columns is longer than Postgres's 63-byte
-- identifier limit, and Postgres would truncate it.
--
-- ORDERING IS SAFE IN BOTH DIRECTIONS. Applied BEFORE the deploy, it leaves an
-- empty table nothing writes. Applied AFTER, each run's write fails, is logged
-- as a class only (`[usage] write failed`), and the answer the reader receives
-- is unchanged: the write starts only after the response has ended. Apply it
-- first anyway, or those runs go uncounted.
--
-- VERIFY AFTER APPLYING — do not skip, and do not trust a tool's exit status:
--
--     \d usage_counts
--
-- must list the nine columns above, every one "not null", with `day` as
-- `date`, `signed_in` as `boolean`, `count` as `integer` and the rest as
-- `text`, and the index "usage_counts_pkey" PRIMARY KEY, btree over (day,
-- environment, surface, signed_in, model, outcome, sources_offered,
-- sources_used), in that order.
--
-- REVERSIBILITY. `DROP TABLE IF EXISTS usage_counts`. It loses the counts
-- only: nothing reads the table, and each later run's write fails and is
-- logged as a class, as before the table existed.
CREATE TABLE IF NOT EXISTS "usage_counts" (
	"day" date NOT NULL,
	"environment" text NOT NULL,
	"surface" text NOT NULL,
	"signed_in" boolean NOT NULL,
	"model" text NOT NULL,
	"outcome" text NOT NULL,
	"sources_offered" text NOT NULL,
	"sources_used" text NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "usage_counts_pkey" PRIMARY KEY("day","environment","surface","signed_in","model","outcome","sources_offered","sources_used")
);
