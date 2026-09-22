// A producer piped into `grep -q` where pipefail is on (#514).
//
// THE CLASS. grep exits at its first match. The producer dies of SIGPIPE — or,
// where SIGPIPE is ignored, gets EPIPE and reports a write error — on its next
// write, and pipefail makes the whole pipeline false. So a line that IS in the
// output reads as absent, and every reading built on that pipeline inverts.
// Measured three times in this repository: `docker logs | grep -q` missed a
// present line 68 of 200 times and passed a clean-log check on a log holding a
// failure 53 of 200 times (#508, fixed in #513); `tar -tf | grep -qE` missed a
// layer holding usr/local/bin/docker 200 of 200 times under GNU tar, which
// would have read as "the off variant ships no docker binary" (#514); and the
// migrate guard's `printf | grep -Eq` failed open — no prompt at all — on every
// multi-line command with more than a pipe buffer of lines after the match.
// None of the three is a timing flake that retries fix: the data was written
// before the read began.
//
// THE FIX THIS ENFORCES. Read the producer's output into a variable and match
// it there (`list=$(producer) && grep -q … <<< "$list"`). Nothing is piped, so
// there is no writer to kill, and the producer's own exit status is still read.
//
// THE UNIVERSE, derived rather than listed. `git ls-files` supplies every path
// this repository tracks; this file reads those that are not on the skip list
// below, and scans the ones that turn pipefail on — by shell text
// (`set -o pipefail`, `set -euo pipefail`, `bash -eo pipefail`) or, in a
// workflow, by `shell: bash`, which is how GitHub spells "and pipefail" for a
// step that names its shell. A workflow step that names no shell runs under
// `bash -e {0}` without pipefail and cannot hit this class, which is why the
// scan asks the file whether pipefail is on at all.
//
// BLIND SPOTS, stated so nothing here is trusted further than it reaches.
//   - The scan is file-level, not step-level: a `| grep -q` in a ci.yml step
//     that sets no pipefail is reported anyway. Reading it into a variable is
//     correct there too, so the report is conservative rather than wrong.
//   - It reads text. A pipeline assembled at runtime, or one inside a string
//     this scan cannot tell from code, is invisible; a `| grep -q` inside a
//     quoted string is reported although nothing runs it. A comment line is
//     skipped: both files fixed here describe the defect in the words that
//     describe it, and prose is not a pipeline — so a pipeline commented out
//     is not reported either.
//   - `grep -q` is the spelling it knows. Other consumers that exit before EOF
//     — `head`, `grep -m N`, `sed …q`, an `awk` with `exit` — are the same
//     class and are NOT read here. `.md` files are skipped: a code block is
//     documentation, not a pipeline this repository runs.
//   - A file that exists but has not been `git add`ed is not tracked and is not
//     scanned. The guard sees it the moment it is staged.
// If git cannot answer, the scan throws rather than narrowing: a guard that
// quietly loses reach is worse than none, because it is still trusted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

// This file carries both forms as fixtures, so it cannot scan itself.
const SELF = 'scripts/pipefail-grep-q.test.mjs';

const SKIP = /\.(md|png|jpe?g|gif|ico|svg|webp|avif|woff2?|ttf|otf|pdf|zip|gz|node)$/i;

/** `set -o pipefail`, `set -euo pipefail`, `bash -eo pipefail`, `shopt -so pipefail`. */
const SETS_PIPEFAIL = /-[A-Za-z]*o\s+pipefail\b/;

/** A workflow step that names bash gets `--noprofile --norc -eo pipefail {0}`. */
const NAMES_BASH_SHELL = /^\s*shell:\s*bash\b/m;

const isWorkflow = (name) => /^\.github\/workflows\/.+\.ya?ml$/.test(name);

/**
 * Lines with a pipeline continued onto the next line folded in, so
 * `producer |` / `grep -q …` is read as the one pipeline it is.
 */
function logicalLines(text) {
  const raw = text.split('\n');
  const out = [];
  for (let i = 0; i < raw.length; i += 1) {
    let line = raw[i];
    let last = i;
    // A line ending in a single `|` (optionally with a line continuation)
    // carries on; `||` is not a pipe.
    while (/(?:^|[^|])\|\s*\\?\s*$/.test(line) && last + 1 < raw.length) {
      last += 1;
      line += ` ${raw[last].trim()}`;
    }
    out.push({ line: i + 1, text: line });
    i = last;
  }
  return out;
}

/** `| grep`, with an assignment, sudo, env or command prefix allowed. */
const PIPE_INTO_GREP =
  /(?<!\|)\|(?!\|)\s*(?:(?:[A-Za-z_]\w*=\S+|sudo|command|env|time|nice)\s+)*[ef]?grep\b([^|;&)]*)/g;

const isQuiet = (args) =>
  args
    .trim()
    .split(/\s+/)
    .some((tok) => /^-[A-Za-z]*q[A-Za-z]*$/.test(tok) || tok === '--quiet' || tok === '--silent');

/** A comment line — shell and YAML `#`, or a JS one. Prose is not a pipeline. */
const IS_COMMENT = /^\s*(?:#|\/\/|\/\*|\*(?!\/)|<!--)/;

/** Every `producer | grep -q` in this text, with the line it starts on. */
export function pipesIntoQuietGrep(text) {
  const found = [];
  for (const { line, text: logical } of logicalLines(text)) {
    if (IS_COMMENT.test(logical)) continue;
    for (const match of logical.matchAll(PIPE_INTO_GREP)) {
      if (isQuiet(match[1])) found.push({ line, text: logical.trim() });
    }
  }
  return found;
}

/**
 * Tracked files that turn pipefail on, as {name, text}. `--full-name` makes the
 * paths repository-relative however the suite is invoked, and `-z` keeps a name
 * containing a newline from splitting into two.
 */
function filesWithPipefail() {
  const listing = execFileSync('git', ['ls-files', '-z', '--full-name'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const tracked = listing.split('\0').filter((name) => name !== '' && name !== SELF && !SKIP.test(name));
  assert.ok(
    tracked.length > 0,
    'git ls-files reported no files at all. The scan has stopped measuring, which looks exactly ' +
      'like a tree with nothing to find — see the header.',
  );
  const out = [];
  for (const name of tracked) {
    const path = join(REPO_ROOT, name);
    // A tracked file deleted from the working tree has nothing to read, and a
    // file too large to be shell is not one.
    if (!existsSync(path) || statSync(path).size > 4 * 1024 * 1024) continue;
    const text = readFileSync(path, 'utf8');
    if (SETS_PIPEFAIL.test(text) || (isWorkflow(name) && NAMES_BASH_SHELL.test(text))) {
      out.push({ name, text });
    }
  }
  return out;
}

test('the scan reads a producer piped into grep -q as the defect it is', () => {
  // The two forms #514 found, verbatim as main carried them at a828355, and
  // #508's, which #513 fixed.
  const shapes = [
    `if tar -tf "$blob" 2>/dev/null | grep -qE '^usr/local/bin/docker$'; then`,
    `if printf '%s' "$command" | grep -Eq '(^|[^[:alnum:]_./-])drizzle-kit[[:space:]]+(migrate|push)([[:space:]]|$)'; then`,
    `if printf '%s' "$command" | grep -Eq '(npm|pnpm|yarn)[[:space:]]+(run[[:space:]]+)?db:(migrate|push)([[:space:]]|$)'; then`,
    `if docker logs ro-with 2>&1 | grep -qiE "EROFS|read-only file system"; then`,
    // The spellings a line-oriented scan is likeliest to miss.
    'docker logs x | grep --quiet EROFS',
    'docker logs x | egrep -q EROFS',
    'docker logs x | LC_ALL=C grep -q EROFS',
    'tar -tf "$blob" |\n  grep -qE "^usr/local/bin/docker$"',
  ];
  for (const shape of shapes) {
    assert.equal(
      pipesIntoQuietGrep(shape).length,
      1,
      `the scan does not read this as a pipe into grep -q, so it would not report it:\n${shape}`,
    );
  }
});

test('the scan passes the forms that cannot lose a line', () => {
  const shapes = [
    // This repository's fixes: the output is read into a variable first.
    `if list=$(tar -tf "$blob" 2>/dev/null) && grep -qE '^usr/local/bin/docker$' <<< "$list"; then`,
    `if grep -Eq '(^|[^[:alnum:]_./-])drizzle-kit[[:space:]]+(migrate|push)([[:space:]]|$)' <<< "$command"; then`,
    'elif grep -qiE "EROFS|read-only file system" <<< "$log"; then',
    // grep as the PRODUCER of a pipe is not this class: it is the reader that
    // exits early, and here the reader is cut, which reads to EOF.
    `stamp=$(grep -m1 -F -- "$WRITABLE" <<< "$(docker logs -t ro-without 2>&1)" | cut -d' ' -f1 || true)`,
    // Not a pipe.
    'test -f x || grep -q EROFS "$file"',
    // A pipe into grep that is not quiet: it writes, so it reads to EOF.
    "grep -E '\\[docker-cli ' /tmp/off-variant-build.log | head -5",
    'docker build . 2>&1 | tee /tmp/build.log',
    // Prose is not a pipeline. Both fixed files describe the defect they
    // fixed, in the words that describe it, and a comment runs nothing.
    '# `printf | grep -q` reads a match as a miss when grep exits first',
    '// Measured: `docker logs | grep -q` missed a present line 68 of 200 times',
  ];
  for (const shape of shapes) {
    assert.deepEqual(
      pipesIntoQuietGrep(shape),
      [],
      `the scan reports this, and it loses no line:\n${shape}`,
    );
  }
});

test('no tracked file that sets pipefail pipes a producer into grep -q', () => {
  const files = filesWithPipefail();
  assert.ok(
    files.some((f) => f.name === '.github/workflows/ci.yml'),
    'the scan found no pipefail in .github/workflows/ci.yml, the workflow behind two required ' +
      'checks. Either the workflow stopped setting it — in which case this anchor goes — or the ' +
      'scan has stopped reading the file it was written for.',
  );
  const reported = [];
  for (const { name, text } of files) {
    for (const hit of pipesIntoQuietGrep(text)) reported.push(`${name}:${hit.line}: ${hit.text}`);
  }
  assert.deepEqual(
    reported,
    [],
    'a producer is piped into `grep -q` where pipefail is on. grep exits at the first match, the ' +
      'producer dies on its next write, pipefail makes the pipeline false, and a line that is ' +
      'there reads as absent. Read the output into a variable and match it there ' +
      '(`out=$(producer) && grep -q … <<< "$out"`):\n' +
      reported.join('\n'),
  );
});
