#!/usr/bin/env bash
# The cases drive.sh runs (#514), on the platform this runs on. Each case runs
# <runs> times and prints one row: what each run read, counted, against what
# it must read. Exits 1 if any run of any case read something else.
#
#   cases.sh <work> <runs> layer|hook ...
#
# <work> is drive.sh's: layer-hits.sh (docker_layer_hits as ci.yml defines
# it), hook.sh (the migrate guard) and hook-<case>.json (the guard's stdin).
# Runs under bash 3.2 (the macOS host) as well as bash 5.
set -uo pipefail
work=$1 runs=$2
shift 2
failed=0
fx=$(mktemp -d)
trap 'rm -rf "$fx"' EXIT

# Each run's result goes on its own line of $fx/results; tally prints them
# counted, e.g. "1:200" or "0:137 1:63".
tally() {
  sort "$fx/results" | uniq -c | awk '{ printf "%s%s:%s", sep, $2, $1; sep = " " }'
}
row() { # label expect
  local got verdict=ok
  got=$(tally)
  if [ "$got" != "$2:$runs" ]; then verdict=MISMATCH; failed=1; fi
  printf '  %-52s expect %-5s got %-18s %s\n' "$1" "$2" "$got" "$verdict"
}

# --- docker_layer_hits, against a stubbed `docker save` ----------------------

# A layer tarball whose listing is usr/, usr/local/, usr/local/bin/, then
# usr/local/bin/docker (for "with"), then <later> more entries of 47 bytes.
layer() { # name with|without later
  local root="$fx/$1.root" i f
  mkdir -p "$root/usr/local/bin" "$root/usr/share/later"
  {
    printf '%s\n' usr/ usr/local/ usr/local/bin/
    if [ "$2" = with ]; then : > "$root/usr/local/bin/docker"; echo usr/local/bin/docker; fi
    printf '%s\n' usr/share/ usr/share/later/
    for ((i = 1; i <= $3; i++)); do
      f=usr/share/later/entry-$(printf '%05d' "$i")-of-a-layer-listing
      : > "$root/$f"
      echo "$f"
    done
  } > "$fx/$1.order"
  tar -cf "$fx/$1.layer" -C "$root" --no-recursion -T "$fx/$1.order"
}

# What `docker save -o` writes (Docker 25+, an OCI layout): the layer blob, and
# beside it JSON files and a config blob that are not tars. <layer> may be
# empty: an image of JSON alone.
saved() { # name layer
  local dir="$fx/$1.save" digest=
  mkdir -p "$dir/blobs/sha256"
  echo '{"imageLayoutVersion":"1.0.0"}' > "$dir/oci-layout"
  echo '{"architecture":"amd64","os":"linux","rootfs":{"type":"layers"}}' > "$dir/config"
  mv "$dir/config" "$dir/blobs/sha256/$(sha256sum "$dir/config" | cut -d' ' -f1)"
  if [ -n "$2" ]; then
    digest=$(sha256sum "$fx/$2.layer" | cut -d' ' -f1)
    cp "$fx/$2.layer" "$dir/blobs/sha256/$digest"
  fi
  echo '{"schemaVersion":2,"manifests":[]}' > "$dir/index.json"
  echo "[{\"Layers\":[\"blobs/sha256/$digest\"]}]" > "$dir/manifest.json"
  tar -cf "$fx/$1.tar" -C "$dir" .
}

layer_case() { # label fixture expect [sigpipe-ignored]
  local i
  : > "$fx/results"
  for ((i = 0; i < runs; i++)); do
    if [ "${4:-}" = sigpipe-ignored ]; then
      FX=$fx FIXTURE=$2 bash -c "trap '' PIPE; exec bash -e \"\$0\"" "$fx/case.sh" 2>/dev/null >> "$fx/results"
    else
      FX=$fx FIXTURE=$2 bash -e "$fx/case.sh" 2>/dev/null >> "$fx/results"
    fi
  done
  row "$1" "$3"
}

run_layer() {
  # One run is one fresh `bash -e`, as the runner runs a step, with the step's
  # own `set -uo pipefail` and `docker save` stubbed to copy a fixture.
  {
    echo 'set -uo pipefail'
    echo 'docker() { if [ "$1" = save ] && [ "$3" = -o ]; then cp "$FX/$2.tar" "$4"; else echo "stub docker: $*" >&2; return 1; fi; }'
    cat "$work/layer-hits.sh"
    echo 'docker_layer_hits "$FIXTURE" "$FX/scan"'
  } > "$fx/case.sh"
  layer early-docker with 3000
  layer early-docker-short with 400
  layer no-docker without 3000
  saved early-docker early-docker
  saved early-docker-short early-docker-short
  saved no-docker no-docker
  saved json-only ''
  echo "docker_layer_hits (ci.yml), layers containing usr/local/bin/docker:"
  layer_case 'docker 4th of 3,006 entries (141 KB after it)' early-docker 1
  layer_case '  the same, SIGPIPE ignored' early-docker 1 sigpipe-ignored
  layer_case 'docker 4th of 406 entries (19 KB after it)' early-docker-short 1
  layer_case 'no docker among 3,005 entries' no-docker 0
  layer_case 'no layer: the JSON files alone' json-only 0
}

# --- the migrate guard hook --------------------------------------------------

hook_case() { # label fixture expect(ask|none)
  local i out code
  : > "$fx/results"
  for ((i = 0; i < runs; i++)); do
    out=$(bash "$work/hook.sh" < "$work/hook-$2.json" 2>/dev/null)
    code=$?
    if [ "$code" -ne 0 ]; then echo "exit-$code"
    elif [ -z "$out" ]; then echo none
    elif [[ $out == *'"permissionDecision": "ask"'* ]]; then echo ask
    else echo other
    fi >> "$fx/results"
  done
  row "$1" "$3"
}

run_hook() {
  echo "the migrate guard hook, decision printed:"
  hook_case 'migrate line, then 106 KB of later lines' long-migrate ask
  hook_case 'db:migrate line, then 106 KB of later lines' long-script ask
  hook_case 'migrate, one 1 MB line' long-line ask
  hook_case '106 KB of lines, no match' long-none none
  hook_case 'migrate, short' migrate ask
  hook_case 'db:migrate, short' script ask
  hook_case 'generate, short' generate none
  hook_case 'unrelated, short' unrelated none
}

echo "== $(uname -s) $(uname -m), bash ${BASH_VERSION}, $(tar --version 2>&1 | sed -n 1p), $runs runs per case"
for what in "$@"; do "run_$what"; done
exit "$failed"
