# Running migrations without losing one to a silent failure

Schema migrations are ordinary Drizzle numbered SQL under [`drizzle/`](../drizzle/), generated with
`npm run db:generate` and applied with `npm run db:migrate` (`drizzle-kit generate` / `drizzle-kit
migrate`). [`docs/deploy.md`](deploy.md#database-and-migrations) is the operator-facing reference:
the compose path, the direct path for fork operators, and the visibility-rename pair `0014`/`0015`.

This document covers the other half — the ways a migration run against a **remote** database can
report success and change nothing. Every trapdoor below was paid for at least once, mid-deploy,
under time pressure, with the failure disguised as a drizzle-kit or migration-content bug when it
was really an env-loading or credential problem upstream.

## The rule, if you read nothing else

**A clean exit from `drizzle-kit migrate` is not proof that anything was applied.** Verify with a
direct query against the database, every time, regardless of what the CLI printed. `docs/deploy.md`
states the same rule for the compose path ("do not trust a tool's exit status alone") — this is that
rule for the direct, remote path.

## Trapdoor 1 — the silent-success exit

The app's default driver is `@neondatabase/serverless` (`DB_DRIVER` unset → `neon-http`; see
`src/lib/db/index.ts`), and `drizzle.config.ts` hands drizzle-kit the same `DATABASE_URL`. On that
path a **password-authentication failure is swallowed**: the only output is the config-file line,
the driver line, and the serverless-driver websocket warning, followed by a clean exit. That is
byte-for-byte what a successful "no migrations to run" looks like.

Causes seen: a rotated credential, the wrong environment's URL, a URL that is syntactically broken
(see trapdoor 3). All three present as success.

**Detection is the read-back, not the exit code.** Immediately after the migrate run:

```bash
op run --env-file=.env.local -- sh -c 'psql "$DATABASE_URL" -c "\d evidence_records"'
```

or, for a migration that adds tables, ask the catalog directly:

```bash
op run --env-file=.env.local -- sh -c \
  'psql "$DATABASE_URL" -c "select table_name from information_schema.tables
     where table_schema = '"'"'public'"'"' order by table_name"'
```

If the column, table, or enum label the migration was supposed to add is not there, the migration
did not run — whatever the CLI said.

## Trapdoor 2 — `op run` needs an `sh -c` wrapper

Any `op run` command whose payload dereferences an injected variable must wrap that payload in
`sh -c` with single quotes:

```bash
# right
op run --env-file=.env.local -- sh -c 'psql "$DATABASE_URL" -c "select 1"'

# wrong — the invoking shell expands $DATABASE_URL to empty before op injects anything
op run --env-file=.env.local -- psql "$DATABASE_URL" -c "select 1"
```

In the unwrapped form the outer shell expands `$DATABASE_URL` *first*, so the command receives an
empty string. `psql` does not error on an empty connection string — it falls back to local
connection defaults. The command appears to work while talking to an entirely different database,
which is the worst possible outcome for a verification step. Caught during the ADR-0016 sweep's M1
gate, 2026-08-06.

A payload that references no variable (for example
`op run --env-file=.env.local -- node scripts/preflight-env.mjs`, the form used in
[`docs/rate-limit-headroom.md`](rate-limit-headroom.md)) does not need the wrapper.

## Trapdoor 3 — the literal-quote `DATABASE_URL`

`export $(grep DATABASE_URL .env.local)` **preserves the quote characters** when the value is
written quoted, which is what most env-pull tooling emits for URLs carrying query parameters. The
export then sets `DATABASE_URL` to a string that begins and ends with a literal `"`, the connection
fails on an invalid scheme, and trapdoor 1 hides the failure behind a clean exit.

`psql` is the diagnostic that surfaces it — it rejects the value out loud where drizzle-kit does
not. A one-line preflight catches it before the migrate run:

```bash
echo "DATABASE_URL prefix: ${DATABASE_URL:0:11}"   # must print exactly: postgresql:
```

No leading `"`, no `op://`. Anything else means the env load is broken and the migrate run will be a
silent no-op. Prefer `op run` (trapdoor 2) over any `export`-from-`grep` pattern; the `op://`
migration that removes literals from `.env.local` altogether is tracked at
[civic-ai-tools-website#101](https://github.com/npstorey/civic-ai-tools-website/issues/101).

## Trapdoor 4 — never point a local stack at `.env.local`

The compose stack does not use `.env.local` and must not be pointed at it. `docker-compose.yml`
composes `DATABASE_URL` for both the `migrate` and `app` services from the `POSTGRES_USER` /
`POSTGRES_PASSWORD` / `POSTGRES_DB` compose variables against the in-stack `postgres` service, and
the one-shot `migrate` service runs `drizzle-kit migrate` *before* the app starts (`app` has a
`depends_on` on its successful completion). A local `docker compose up` therefore always boots on a
migrated schema, and re-running is safe — applied migrations are skipped.

Two consequences worth stating plainly:

- **You do not run migrations by hand for the local stack.** Bringing the stack up is the migration.
- **A `.env.local` aimed at a local stack is a loaded gun.** `.env.local` holds credentials for the
  hosted database. Sourcing it into a shell that then runs `drizzle-kit migrate` against what you
  believe is a local container is how a remote database gets migrated by accident.

Verify a compose-path migration inside the stack, not through `.env.local`:

```bash
docker compose exec postgres psql -U civic -d civic -c '\dT+ visibility'
```

## Checklist

1. `op whoami` — confirm the `op` session the subprocess will inherit.
2. Preflight the URL shape: prefix must be `postgresql:`.
3. Run the migration.
4. Read back with `psql`. Do not skip this because the CLI exited 0 — that is precisely trapdoor 1.
5. If the run hangs more than ~10 seconds with no output, kill it and check `op` sign-in state
   before rerunning; an unresolvable `op://` reference yields an empty `DATABASE_URL` and a
   connection that never opens.
