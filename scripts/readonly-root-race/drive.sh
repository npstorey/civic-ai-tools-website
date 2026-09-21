#!/usr/bin/env bash
# Drives the CI step "The runtime image under a read-only root filesystem"
# (.github/workflows/ci.yml, job "container image build") against stub images
# whose optimiser write lands before the response, after it, or never, and
# reports how the step ended for each (#508). Nothing runs this in CI: run it
# after changing that step, or after a Next.js bump changes when the write
# happens.
#
#   scripts/readonly-root-race/drive.sh          the step in the working tree
#   scripts/readonly-root-race/drive.sh <ref>    the step as it was at <ref>
#
# The step runs as CI runs it — under `bash -e`, GitHub's shell for a `run:`
# with no `shell:` — with its image name replaced by each stub's. It needs
# bash 5 ($EPOCHREALTIME), GNU date, curl and a docker daemon whose published
# ports answer on 127.0.0.1. Where the host lacks one of those (macOS), the
# step runs in stub.Dockerfile's `driver` stage on the daemon's own network.
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(git -C "$here" rev-parse --show-toplevel) || exit 1
STEP='The runtime image under a read-only root filesystem'
work=$(mktemp -d)
trap 'rm -rf "$work"; docker rm -f ro-with ro-without >/dev/null 2>&1' EXIT

if [ $# -ge 1 ]; then
  git -C "$root" show "$1:.github/workflows/ci.yml" > "$work/ci.yml" || exit 1
else
  cp "$root/.github/workflows/ci.yml" "$work/ci.yml"
fi

# The step's `run: |` block, dedented.
awk -v step="$STEP" '
  index($0, "- name: " step) { found = 1; next }
  found && !inrun && /^ *run: \|/ { inrun = 1; match($0, /^ */); ind = RLENGTH + 2; next }
  inrun { if ($0 != "" && match($0, /^ */) && RLENGTH < ind) exit; print substr($0, ind + 1) }
' "$work/ci.yml" > "$work/step.sh"
if [ ! -s "$work/step.sh" ]; then
  echo "no step named \"$STEP\" in that ci.yml"
  exit 1
fi

if [ "$(uname)" = Linux ] && [ -n "${EPOCHREALTIME:-}" ] && date -d @0 >/dev/null 2>&1; then
  run_step() { bash -e "$1"; }
else
  docker build -q --target driver -t readonly-root-race-driver -f "$here/stub.Dockerfile" "$here" >/dev/null || exit 1
  run_step() {
    docker run --rm -i --network host -v /var/run/docker.sock:/var/run/docker.sock \
      readonly-root-race-driver bash -e -s < "$1"
  }
fi

# Each case, how the step as #508 left it must end on it, and for a failure the
# error that must be the reason: a failure for some other reason is not the
# check under test failing.
cases=('before' 'never' 'late 700' 'second 500')
expect=(pass fail pass fail)
reason=('' 'without the mount NOTHING failed a write' '' 'with the documented mount still failed a write')
summary=()
for i in "${!cases[@]}"; do
  read -r mode delay <<< "${cases[$i]}"
  delay=${delay:-0}
  tag="readonly-root-stub:$mode-$delay"
  docker build -q --target stub --build-arg "MODE=$mode" --build-arg "DELAY_MS=$delay" \
    -t "$tag" -f "$here/stub.Dockerfile" "$here" >/dev/null || exit 1
  sed "s/civic-app:ci/$tag/g" "$work/step.sh" > "$work/case.sh"
  docker rm -f ro-with ro-without >/dev/null 2>&1
  echo "=== ${cases[$i]} (expect ${expect[$i]}${reason[$i]:+: ${reason[$i]}})"
  run_step "$work/case.sh" > "$work/out" 2>&1
  code=$?
  sed 's/^/    /' "$work/out"
  got=$([ "$code" -eq 0 ] && echo pass || echo fail)
  verdict=ok
  if [ "$got" != "${expect[$i]}" ]; then
    verdict=MISMATCH
  elif [ -n "${reason[$i]}" ] && ! grep -qF -- "${reason[$i]}" "$work/out"; then
    verdict="MISMATCH (failed, but not for the reason under test)"
  fi
  summary+=("$(printf '%-12s expect %-4s  got %-4s  %s' "${cases[$i]}" "${expect[$i]}" "$got" "$verdict")")
done
echo "=== summary"
printf '%s\n' "${summary[@]}"
