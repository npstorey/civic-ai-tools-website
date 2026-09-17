#!/bin/sh
# POC MCP-LIVE-SOURCE — the one owner-run command.
#
# WHERE THE KEY COMES FROM, in order:
#
#   1. THE PARENT ENVIRONMENT, when MODEL_API_KEY or OPENROUTER_API_KEY is
#      already set there. This is the path to use, because it is the one that
#      works when the env file holds `op://` references rather than literals:
#
#        op run --env-file=<env file> -- sh scripts/poc-live-source/owner-run-questions.sh
#
#      `op run` resolves each reference and exports the real value, so this
#      script never touches the file at all.
#
#   2. THE FILE, read directly, ONLY as a fallback for a literal value.
#
# WHY THE ORDER IS THIS WAY. The first questions run read the file with `sed`
# and handed the process an `op://` reference: a non-empty string, which passed
# a presence check, and not a credential — so all ten model calls came back
# "401 Missing Authentication header". The run cost a sandbox and measured
# nothing. Preferring an already-resolved value removes that failure for the
# path the operator actually uses, and the fallback below now refuses a
# reference by its SHAPE instead of passing it on.
#
# The node process this starts probes the credential with one real model call
# before it creates anything, so a key that is present and unusable stops the
# run at no cost. That probe, not this script, is the check that can fail.
#
# WHY `env -i`. The parent shell carries whatever it carries — a stale
# SOCRATA_MCP_URL, a MODEL_CATALOG_PATH pointing into a container, a
# VERCEL_TOKEN. Any of those silently changes what is measured. `env -i` starts
# from nothing and adds back exactly three names: PATH, HOME and the model key.
# Driven with those four decoys set in the parent, none reached the process.
#
# SECRET HYGIENE. The key is held in a shell variable, passed to `env` as an
# assignment, and never echoed. This script prints variable NAMES, the word
# present/absent, and — for the one refusal below — the fact that a value began
# with "op://". No value, no length, no other prefix.
#
# Usage:
#   op run --env-file="$HOME/code/civic-ai-tools-website/.env.compose.local" -- \
#     sh scripts/poc-live-source/owner-run-questions.sh
#
#   sh scripts/poc-live-source/owner-run-questions.sh [path-to-env-file]   # literal fallback
set -eu

WORKTREE="$HOME/code/civic-ai-tools-website-poc-live-source"
ENV_FILE="${1:-$HOME/code/civic-ai-tools-website/.env.compose.local}"

KEY=""
NAME=""
SOURCE=""

# --- 1. the parent environment, already resolved -----------------------------
if [ -n "${MODEL_API_KEY:-}" ]; then
  KEY="$MODEL_API_KEY"; NAME=MODEL_API_KEY; SOURCE="the parent environment"
elif [ -n "${OPENROUTER_API_KEY:-}" ]; then
  KEY="$OPENROUTER_API_KEY"; NAME=OPENROUTER_API_KEY; SOURCE="the parent environment"
fi

# --- 2. the file, for a literal ----------------------------------------------
if [ -z "$KEY" ]; then
  if [ ! -f "$ENV_FILE" ]; then
    echo "no MODEL_API_KEY or OPENROUTER_API_KEY in the environment, and no env file at:"
    echo "  $ENV_FILE"
    echo
    echo "If that file holds op:// references, run this under op run instead:"
    echo "  op run --env-file=<env file> -- sh scripts/poc-live-source/owner-run-questions.sh"
    exit 1
  fi
  KEY=$(sed -n 's/^[[:space:]]*MODEL_API_KEY=//p' "$ENV_FILE" | head -1)
  NAME=MODEL_API_KEY
  if [ -z "$KEY" ]; then
    KEY=$(sed -n 's/^[[:space:]]*OPENROUTER_API_KEY=//p' "$ENV_FILE" | head -1)
    NAME=OPENROUTER_API_KEY
  fi
  # Strip one layer of surrounding single or double quotes, if present.
  KEY=$(printf '%s' "$KEY" | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/")
  SOURCE="$ENV_FILE"

  if [ -z "$KEY" ]; then
    echo "neither MODEL_API_KEY= nor OPENROUTER_API_KEY= has a non-empty value in $ENV_FILE"
    echo "nothing was created and nothing was billed."
    exit 1
  fi

  # A SHAPE test, not a read of the value: an op:// reference is a pointer to a
  # credential, and passing one on is what voided the first run.
  case "$KEY" in
    op://*)
      echo "$NAME in $ENV_FILE is an op:// reference, not a credential."
      echo "Resolve it before this process starts:"
      echo "  op run --env-file=\"$ENV_FILE\" -- sh scripts/poc-live-source/owner-run-questions.sh"
      echo
      echo "nothing was created and nothing was billed."
      exit 1
      ;;
  esac
fi

echo "key: $NAME, taken from $SOURCE (name only — the value is never printed)"
echo "passing exactly: PATH, HOME, MODEL_API_KEY"
echo "running in: $WORKTREE"
echo

cd "$WORKTREE"

# POC_STEP0_ONLY is forwarded when set, so this exact command can be driven once
# without creating or billing anything. With the credential probe in place that
# rehearsal now proves the key WORKS, not merely that it arrived.
if [ -n "${POC_STEP0_ONLY:-}" ]; then
  exec env -i PATH="$PATH" HOME="$HOME" MODEL_API_KEY="$KEY" POC_STEP0_ONLY=1 \
    node --no-warnings scripts/poc-live-source/run-questions.mjs
fi

exec env -i PATH="$PATH" HOME="$HOME" MODEL_API_KEY="$KEY" \
  node --no-warnings scripts/poc-live-source/run-questions.mjs
