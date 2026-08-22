#!/usr/bin/env bash
# PreToolUse:Bash guard — escalate schema-applying drizzle-kit runs to the owner.
#
# WHY. `drizzle-kit migrate` against the remote database can print its normal
# output and exit 0 without applying anything: on the @neondatabase/serverless
# path an authentication failure is swallowed and looks byte-for-byte like
# "no migrations to run". A migration lost that way is discovered later, in
# production, under time pressure. This hook makes the owner see the run and
# attaches the only reliable detection — the psql read-back — to the prompt.
# The trapdoors are written up in docs/db-migrations.md.
#
# CONTRACT. PreToolUse decisions are allow | deny | ask ("escalate to the user"
# is spelled "ask"; "escalate" is not a value the CLI accepts). This hook never
# denies: applying a migration is legitimate work, it just must not happen
# unattended. Exit 0 with no output on every other command, so the normal
# permission flow is untouched.
#
# Matches drizzle-kit migrate/push however it is spelled: directly, via npx, or
# through the package scripts (npm run db:migrate). `drizzle-kit generate` and
# `drizzle-kit studio` are deliberately NOT matched — neither applies schema.

set -uo pipefail

input=$(cat)

command=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)
[ -n "$command" ] || exit 0

applies_schema=0

# drizzle-kit migrate | drizzle-kit push, with any flags between the two words
# ruled out: the subcommand is the first bare word after the binary name.
if printf '%s' "$command" | grep -Eq '(^|[^[:alnum:]_./-])drizzle-kit[[:space:]]+(migrate|push)([[:space:]]|$)'; then
  applies_schema=1
fi

# The package scripts that wrap them (see package.json: db:migrate).
if printf '%s' "$command" | grep -Eq '(npm|pnpm|yarn)[[:space:]]+(run[[:space:]]+)?db:(migrate|push)([[:space:]]|$)'; then
  applies_schema=1
fi

[ "$applies_schema" -eq 1 ] || exit 0

reason='verify with psql after — drizzle-kit can print success without applying. A clean exit is not proof: on the remote @neondatabase/serverless path an auth failure produces output identical to "no migrations to run". Read the schema back with `op run --env-file=.env.local -- sh -c '"'"'psql "$DATABASE_URL" -c "\d <table>"'"'"'` before reporting the migration applied. See docs/db-migrations.md.'

jq -n --arg reason "$reason" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "ask",
    permissionDecisionReason: $reason
  }
}'
exit 0
