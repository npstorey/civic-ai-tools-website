-- civic-ai-tools-website#632 W2 (D4 = A): the consent store for a signed-in
-- reader.
--
-- WHAT IT HOLDS. One row per account, keyed on `users.id`:
--   user_id          the account (the session's `dbId`); deleting the account
--                    deletes its consent.
--   states           JSON, per source id: { state, since }, the state being
--                    `on`, `ask-first` or `off` and `since` the calendar date
--                    (YYYY-MM-DD) it was given. No time of day.
--   flows_hash       the SHA-256 of the flows statement (`/api/flows`) the
--                    reader was shown when they consented.
--   flows_statement  that statement itself, which the re-ask rule compares
--                    with the statement in force (D5 = A).
--   consented_at     when the consent was first given.
--   updated_at       when a state last changed.
-- Nullable nothing: a row is a consent, and a revoke deletes it (D4 = A), so
-- no column has a "no value yet" state. An anonymous reader's consent is a
-- session cookie, never a row; the table holds no question, no identifier
-- other than the account key, and no network address.
--
-- OWNER-RUN. Applied by hand via psql, ahead of the deploy that starts reading
-- this table. A downstream fork applies this same file through an ordinary
-- `drizzle-kit migrate`, so both paths must be safe on a database that already
-- has the table: `CREATE TABLE IF NOT EXISTS` makes the statement idempotent,
-- and the foreign key is written inside it, not as a separate
-- `ALTER TABLE ... ADD CONSTRAINT` (which has no IF NOT EXISTS form and would
-- fail on a second run). `drizzle-kit generate` emits neither `IF NOT EXISTS`
-- nor the inline key; both were written by hand here and should stay. (The same
-- two-application-paths reasoning as 0014 and 0016.)
--
-- ORDERING IS SAFE IN BOTH DIRECTIONS. Applied BEFORE the deploy, it leaves an
-- empty table nothing reads. Applied AFTER, every signed-in session with a
-- `dbId` fails its consent read, so apply it first.
--
-- VERIFY AFTER APPLYING — do not skip, and do not trust a tool's exit status:
--
--     \d source_consents
--
-- must list the six columns above, every one "not null", `user_id` as the
-- primary key with a foreign key to users(id) ON DELETE CASCADE, and the two
-- times as `timestamp with time zone`.
--
-- REVERSIBILITY. `DROP TABLE IF EXISTS source_consents`. It deletes every
-- signed-in reader's consent, so each is asked again at the next question:
-- a real rollback, with no data loss beyond the consents themselves.
CREATE TABLE IF NOT EXISTS "source_consents" (
	"user_id" uuid PRIMARY KEY NOT NULL CONSTRAINT "source_consents_user_id_users_id_fk" REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action,
	"states" jsonb NOT NULL,
	"flows_hash" text NOT NULL,
	"flows_statement" jsonb NOT NULL,
	"consented_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
