---
paths:
  - "drizzle/**"
  - "src/lib/db/**"
---

# Database and migrations

Before generating, applying, or reviewing a migration, read
[`docs/db-migrations.md`](../../docs/db-migrations.md). It carries the failure modes that make a
migration run *look* like it worked:

- **A clean exit from `drizzle-kit migrate` is not proof.** On the remote `@neondatabase/serverless`
  path an authentication failure produces output identical to "no migrations to run". Verify with a
  direct `psql` read-back every time.
- **`op run` needs an `sh -c` wrapper** whenever the payload dereferences an injected variable, or
  the outer shell expands it to empty first and `psql` silently connects to local defaults.
- **Never point a local stack at `.env.local`.** `docker compose up` runs the one-shot `migrate`
  service against the in-stack Postgres before the app boots; `.env.local` holds hosted-database
  credentials, and sourcing it into a "local" migrate run is how a remote database gets migrated by
  accident.

[`docs/deploy.md`](../../docs/deploy.md#database-and-migrations) is the operator-facing companion:
the compose path, the direct path for fork operators, and why the visibility-rename pair `0014` +
`0015` must stay two files in that order.

Commands: `npm run db:generate` (author), `npm run db:migrate` (apply), `npm run db:studio`.
A `PreToolUse` hook (`.claude/hooks/drizzle-migrate-guard.sh`) escalates `drizzle-kit
migrate`/`push` to the owner with the read-back reminder attached — that prompt is the rule, not an
obstacle to route around.
