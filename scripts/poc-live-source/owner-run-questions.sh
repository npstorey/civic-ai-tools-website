#!/bin/sh
# POC MCP-LIVE-SOURCE — the one owner-run command.
#
# WHAT IT DOES. Reads ONE variable out of the compose env file, hands it to a
# node process through an environment that has been emptied first, and runs the
# questions leg. Nothing else from the calling shell reaches the process.
#
# WHY `env -i`. The parent shell of an owner's terminal carries whatever it
# carries — a stale SOCRATA_MCP_URL, a MODEL_CATALOG_PATH pointing into a
# container, a VERCEL_TOKEN. Any of those silently changes what is measured.
# `env -i` starts from nothing and adds back exactly three names: PATH, HOME
# and the model key. The warm-VM spike tested this same shape with decoys set in
# the parent and confirmed none of them reached the process.
#
# SECRET HYGIENE. The key is held in a shell variable, passed to `env` as an
# assignment, and never echoed. This script prints variable NAMES only. The
# node process it starts prints names only too, and scans its own output files
# afterwards.
#
# Usage:  sh temp/owner-run-questions.sh [path-to-env-file]
set -eu

ENV_FILE="${1:-$HOME/code/civic-ai-tools-website/.env.compose.local}"
WORKTREE="$HOME/code/civic-ai-tools-website-poc-live-source"

if [ ! -f "$ENV_FILE" ]; then
  echo "env file not found: $ENV_FILE"
  echo "pass the right path as the first argument."
  exit 1
fi

# The canonical name first, its prior-era name second. Only the part after the
# first "=" is taken, and surrounding quotes are stripped. The value is never
# printed, and its length is never derived.
KEY=$(sed -n 's/^[[:space:]]*MODEL_API_KEY=//p' "$ENV_FILE" | head -1)
NAME=MODEL_API_KEY
if [ -z "$KEY" ]; then
  KEY=$(sed -n 's/^[[:space:]]*OPENROUTER_API_KEY=//p' "$ENV_FILE" | head -1)
  NAME=OPENROUTER_API_KEY
fi
# Strip one layer of surrounding single or double quotes, if present.
KEY=$(printf '%s' "$KEY" | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/")

if [ -z "$KEY" ]; then
  echo "neither MODEL_API_KEY= nor OPENROUTER_API_KEY= has a non-empty value in $ENV_FILE"
  echo "nothing was created and nothing was billed."
  exit 1
fi

echo "reading $NAME from $ENV_FILE (name only — the value is never printed)"
echo "passing exactly: PATH, HOME, MODEL_API_KEY"
echo "running in: $WORKTREE"
echo

cd "$WORKTREE"

# POC_STEP0_ONLY is forwarded when set, so this exact command can be driven once
# without creating or billing anything before it is trusted with a real run.
if [ -n "${POC_STEP0_ONLY:-}" ]; then
  exec env -i PATH="$PATH" HOME="$HOME" MODEL_API_KEY="$KEY" POC_STEP0_ONLY=1 \
    node --no-warnings scripts/poc-live-source/run-questions.mjs
fi

exec env -i PATH="$PATH" HOME="$HOME" MODEL_API_KEY="$KEY" \
  node --no-warnings scripts/poc-live-source/run-questions.mjs
