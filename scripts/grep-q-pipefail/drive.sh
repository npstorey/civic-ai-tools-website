#!/usr/bin/env bash
# Drives the two reads #514 names, where a producer was piped into `grep -q`
# under pipefail, and counts how often each reads a line that is there as
# absent. grep exits at its first match, the producer dies of SIGPIPE (or gets
# EPIPE) on its next write, and pipefail makes the pipeline false. Nothing runs
# this in CI or npm test: run it after changing either read.
#
#   scripts/grep-q-pipefail/drive.sh [ref] [runs]    (default: working tree, 200)
#
# 1. docker_layer_hits, in the ci.yml step "The off variant builds no
#    docker-cli stage and ships no docker binary" (job "container image
#    build"). It runs under `bash -e`, as the runner runs a step, with
#    `docker save` stubbed to hand it a layer that lists usr/local/bin/docker
#    early. In driver.Dockerfile's image, which is the runner's: GNU tar is
#    the producer that dies. macOS bsdtar measured 0 misses in 200 on the same
#    shape (#514), so the host cannot show this red.
# 2. .claude/hooks/drizzle-migrate-guard.sh, on commands whose matching line is
#    followed by more than a pipe buffer of later lines. Under this host's bash
#    (3.2 on macOS) and under bash 5 in the same image.
#
# Exits 1 if any run of any case read something other than its expectation.
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(git -C "$here" rev-parse --show-toplevel) || exit 1
runs=${2:-200}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

if [ -n "${1:-}" ]; then
  git -C "$root" show "$1:.github/workflows/ci.yml" > "$work/ci.yml" || exit 1
  git -C "$root" show "$1:.claude/hooks/drizzle-migrate-guard.sh" > "$work/hook.sh" || exit 1
  echo "reads as of $1 ($(git -C "$root" rev-parse --short "$1"))"
else
  cp "$root/.github/workflows/ci.yml" "$work/ci.yml"
  cp "$root/.claude/hooks/drizzle-migrate-guard.sh" "$work/hook.sh"
  echo "reads as in the working tree"
fi

# docker_layer_hits() as the step defines it, dedented.
awk '
  !found && /^ *docker_layer_hits\(\) \{/ { found = 1; match($0, /^ */); pad = substr($0, 1, RLENGTH) }
  found { print substr($0, length(pad) + 1); if ($0 == pad "}") exit }
' "$work/ci.yml" > "$work/layer-hits.sh"
if [ "$(sed -n '$p' "$work/layer-hits.sh")" != "}" ]; then
  echo "no docker_layer_hits() { ... } in that ci.yml"
  exit 1
fi

# The hook's stdin, as Claude Code sends it for a Bash call. The command goes
# to jq on stdin: a 1 MB `--arg` is over macOS's ARG_MAX.
fixture() {
  printf '%s' "$2" | jq -Rs '{tool_name: "Bash", tool_input: {command: .}}' > "$work/hook-$1.json" || exit 1
}
later=$(for i in $(seq 1 2000); do printf 'echo "later line %05d of a long multi-line command"\n' "$i"; done)
long=$(printf '%*s' 1048576 '' | tr ' ' x)
fixture long-migrate "cd /app
npx drizzle-kit migrate
$later"
fixture long-script "npm run db:migrate
$later"
fixture long-line "npx drizzle-kit migrate --config drizzle.config.ts # $long"
fixture long-none "$later"
fixture migrate 'npx drizzle-kit migrate'
fixture script 'npm run db:migrate'
fixture generate 'npx drizzle-kit generate'
fixture unrelated 'git status --short'

failed=0
bash "$here/cases.sh" "$work" "$runs" hook || failed=1
docker build -q -t grep-q-pipefail-driver -f "$here/driver.Dockerfile" "$here" > /dev/null || exit 1
docker run --rm -v "$work:/work:ro" -v "$here:/drive:ro" grep-q-pipefail-driver \
  bash /drive/cases.sh /work "$runs" layer hook || failed=1
exit "$failed"
