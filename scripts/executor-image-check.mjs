#!/usr/bin/env node
/**
 * Builds the notebook-executor image (docker/executor/Dockerfile) and checks
 * the built image, not the file (#490). CI's `executor image build` job runs
 * each step below as its own step; run locally, the same commands do the
 * same thing.
 *
 *   node --experimental-strip-types scripts/executor-image-check.mjs <step> \
 *     [--image <tag>] [--dockerfile <path>]
 *
 *   build       docker build -f <dockerfile> -t <tag> docker/executor
 *   pins        every pinned version is the one `pip freeze` reports, and the
 *               python minor version is PYTHON_RUNTIME_VERSION
 *   imports     `pip check` is clean and every pinned package imports
 *   user        the image's default user is not root
 *   font-cache  matplotlib's font cache is warm for that user
 *   parity      scripts/fixtures/parity-notebook.ipynb executes through the
 *               real container driver (scripts/executor-parity.mjs)
 *   all         build, then every check, and exit non-zero if any failed
 *
 * WHY THE BUILT IMAGE. `src/lib/sandbox/executor-pins.test.ts` and
 * `./container.test.ts` read the Dockerfile's TEXT: pins, `USER`, the order of
 * the font-cache warm. A file can say all of that and still build an image
 * that runs as root, carries a different version than it names, or leaves the
 * cache cold for the user that runs. These checks read the image.
 *
 * THE EXPECTED VERSIONS ARE NOT WRITTEN HERE. They are imported from the two
 * tables the Dockerfile's own header names as the single source —
 * `PINNED_LIBRARIES` and `PYTHON_RUNTIME_VERSION`
 * (src/lib/notebook-author/prompt.ts) and `EXECUTOR_TOOLING_PACKAGES`
 * (src/lib/sandbox/driver.ts). A pin added to either table is checked here
 * with no edit to this file.
 *
 * WHAT EACH CHECK CAN FAIL ON, and the shape that shows it can:
 *   pins        a pin changed or dropped in the Dockerfile. A dropped pin whose
 *               package something else still pulls in reads as a version
 *               mismatch, one nothing pulls in as absent.
 *   build       a pin set pip cannot resolve (conflicting requirements, a
 *               version with no wheel for this python) fails the build, and
 *               the build step names that as a co-install failure.
 *   imports     a set that installs but does not import — a dependency
 *               removed after the install, say. `pip check` names the broken
 *               requirement; the import names the package.
 *   user        a Dockerfile with no `USER` line runs as uid 0.
 *   font-cache  a warm run as root (above `USER`) writes a cache the running
 *               user either cannot read or cannot write, and matplotlib then
 *               rebuilds it, logging `generated new fontManager` at INFO. The
 *               check runs a fresh container as the image's default user with
 *               logging at INFO and fails on that line. Its CONTROL runs the
 *               same probe against an empty cache directory, where the line
 *               must appear: a probe that cannot see a rebuild proves nothing
 *               by staying quiet, so the absence counts only when the control
 *               saw it.
 *   parity      the fixture sets matplotlib's logging to ERROR, so this step
 *               cannot see a cold cache (that is the font-cache step's job).
 *               It proves the executor runs a notebook end to end through
 *               src/lib/sandbox/container.ts, and that the kernel reported the
 *               pinned versions of the libraries the fixture prints.
 *
 * BLIND SPOTS, stated.
 *   - Transitive versions are not pinned and are not checked; they float
 *     with PyPI (executor-pins.test.ts says the same).
 *   - The import check imports each pinned package by its distribution name.
 *     True of every pin at this commit; a future pin whose module name
 *     differs fails here by name rather than passing unread.
 *   - One architecture per run. CI's runner is amd64; a local run on another
 *     architecture is evidence about that architecture only.
 *   - The image comes from PyPI and Docker Hub, anonymously. An outage of
 *     either fails the build step, which says so; it is not a defect here.
 *
 * Credential-free: no step reads a secret or needs one, and the parity run is
 * handed an environment with the two notebook API variables removed, so a
 * local run cannot carry a real token into the container either.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const BUILD_CONTEXT = 'docker/executor';
const DEFAULT_DOCKERFILE = 'docker/executor/Dockerfile';
/**
 * Not the driver's image name at all, so a local run never replaces an
 * operator's image, and src/lib/sandbox/executor-pins.test.ts (which holds
 * every tracked `civic-notebook` + `-executor:<tag>` to one tag) does not
 * read this throwaway tag as a site that disagrees. The parity step hands it
 * to the driver through EXECUTOR_CONTAINER_IMAGE.
 */
export const DEFAULT_IMAGE = 'executor-image-check:local';

const PROMPT_SOURCE = 'src/lib/notebook-author/prompt.ts';
const DRIVER_SOURCE = 'src/lib/sandbox/driver.ts';

/** The line matplotlib logs at INFO when it rebuilds the font cache. */
export const FONT_REBUILD_LINE = 'generated new fontManager';
/** Logged when the cache directory is not writable, so the cache lands in a throwaway dir. */
export const TEMP_CACHE_LINE = 'created a temporary cache directory';

const FONT_PROBE =
  'import logging; logging.basicConfig(level=logging.INFO); import matplotlib.pyplot';

// --- pure readings (exported for scripts/executor-image-check.test.mjs) ----

/** PEP 503 normalisation: `jupyter_client` and `Jupyter-Client` are one project. */
export function normalizeName(name) {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

/**
 * Every pin the image must carry, as [{name, version, source}], read from the
 * tables. `source` names the table so a failure says where the version lives.
 */
export function expectedPins(pinnedLibraries, toolingPackages) {
  return [
    ...Object.entries(pinnedLibraries).map(([name, version]) => ({
      name,
      version,
      source: `${PROMPT_SOURCE} PINNED_LIBRARIES`,
    })),
    ...Object.entries(toolingPackages).map(([name, version]) => ({
      name,
      version,
      source: `${DRIVER_SOURCE} EXECUTOR_TOOLING_PACKAGES`,
    })),
  ];
}

/** `pip freeze` output → Map(normalized name → version). Non-`==` lines are skipped. */
export function parseFreeze(text) {
  const out = new Map();
  for (const raw of text.split('\n')) {
    const m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)==(\S+)\s*$/.exec(raw);
    if (m) out.set(normalizeName(m[1]), m[2]);
  }
  return out;
}

/** One problem string per pin that `pip freeze` does not report at its version. */
export function comparePins(pins, freeze) {
  const problems = [];
  for (const pin of pins) {
    const found = freeze.get(normalizeName(pin.name));
    if (found === undefined) {
      problems.push(
        `${pin.name}: expected ${pin.version} (${pin.source}); pip freeze reports no ${pin.name} at all`,
      );
    } else if (found !== pin.version) {
      problems.push(
        `${pin.name}: expected ${pin.version} (${pin.source}); pip freeze reports ${pin.name}==${found}`,
      );
    }
  }
  return problems;
}

/** `id -u` output → a problem string, or null when the uid is a non-root integer. */
export function userProblem(idOutput) {
  const text = idOutput.trim();
  if (!/^\d+$/.test(text)) return `\`id -u\` printed ${JSON.stringify(text)}, not a uid`;
  if (Number(text) === 0) {
    return "the image's default user is uid 0 (root); the executor runs model-written code and must not run it as root (#450)";
  }
  return null;
}

/** Which cold-cache signals a probe's output carries. */
export function coldCacheSignals(output) {
  return [FONT_REBUILD_LINE, TEMP_CACHE_LINE].filter((line) => output.includes(line));
}

/**
 * Why a build failed, as far as the log says. A resolver failure is a pin set
 * that does not co-install; a failure in the warm step is a set that installs
 * and does not import.
 */
export function classifyBuildFailure(log) {
  // Reachability first: pip reports an unreachable index as "Could not find a
  // version that satisfies" too, which would otherwise read as a conflict.
  if (
    /Network is unreachable|Temporary failure in name resolution|Failed to connect to|failed to fetch anonymous token|connection refused|TLS handshake|i\/o timeout|toomanyrequests/i.test(
      log,
    )
  ) {
    return 'the build could not reach a registry (Docker Hub or PyPI); this is not a defect in the image';
  }
  if (
    /ResolutionImpossible|conflicting dependencies|Could not find a version that satisfies|No matching distribution found/.test(
      log,
    )
  ) {
    return 'the pinned set does not co-install: pip could not resolve it (see the resolver output above)';
  }
  if (/import matplotlib\.pyplot/.test(log) && /(ModuleNotFoundError|ImportError)/.test(log)) {
    return 'the pinned set installs but does not import: the font-cache warm step failed to import matplotlib.pyplot';
  }
  return 'the image did not build (see the build output above)';
}

// --- running things ---------------------------------------------------------

/** Run a command; stream its output through and also return it. Never rejects on exit code. */
function run(cmd, args, { env, quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: REPO_ROOT, env: env ?? process.env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (!quiet) process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (!quiet) process.stderr.write(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

/** `docker run --rm <image> …` as the image's default user (no --user flag). */
function inImage(image, args, extra = []) {
  return run('docker', ['run', '--rm', ...extra, image, ...args], { quiet: true });
}

// GitHub renders `::error::` on stdout as an annotation; elsewhere it is just a line.
function fail(message) {
  console.log(`::error::${message}`);
  return false;
}

function ok(message) {
  console.log(`OK — ${message}`);
  return true;
}

async function loadTables() {
  const prompt = await import('../src/lib/notebook-author/prompt.ts');
  const driver = await import('../src/lib/sandbox/driver.ts');
  return {
    pins: expectedPins(prompt.PINNED_LIBRARIES, driver.EXECUTOR_TOOLING_PACKAGES),
    python: prompt.PYTHON_RUNTIME_VERSION,
  };
}

// --- the steps --------------------------------------------------------------

async function stepBuild({ image, dockerfile }) {
  console.log(`building ${image} from ${dockerfile} (context ${BUILD_CONTEXT})`);
  const started = Date.now();
  const result = await run('docker', [
    'build',
    '--progress=plain',
    '-f',
    dockerfile,
    '-t',
    image,
    BUILD_CONTEXT,
  ]);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (result.code !== 0) {
    return fail(`BUILD FAILED after ${seconds}s — ${classifyBuildFailure(result.stdout + result.stderr)}`);
  }
  return ok(`${image} built in ${seconds}s`);
}

async function stepPins({ image }) {
  const { pins, python } = await loadTables();
  const freeze = await inImage(image, ['pip', 'freeze']);
  if (freeze.code !== 0) return fail(`\`pip freeze\` exited ${freeze.code} in ${image}:\n${freeze.stderr}`);
  const reported = parseFreeze(freeze.stdout);
  if (reported.size === 0) {
    return fail(`\`pip freeze\` in ${image} reported no packages; the reading cannot see any pin`);
  }
  let passed = true;
  const problems = comparePins(pins, reported);
  if (problems.length > 0) {
    passed = fail(
      `PIN MISMATCH — ${problems.length} of ${pins.length} pinned versions are not what the image carries:\n  ${problems.join('\n  ')}`,
    );
  } else {
    ok(
      `all ${pins.length} pins are what pip freeze reports: ${pins.map((p) => `${p.name}==${p.version}`).join(' ')}`,
    );
  }

  const py = await inImage(image, ['python', '-c', 'import sys; print("%d.%d.%d" % sys.version_info[:3])']);
  const minor = py.stdout.trim().split('.').slice(0, 2).join('.');
  if (py.code !== 0 || minor !== python) {
    passed = fail(
      `PYTHON MISMATCH — expected ${python} (${PROMPT_SOURCE} PYTHON_RUNTIME_VERSION); the image runs ${py.stdout.trim() || `nothing (exit ${py.code})`}`,
    );
  } else {
    ok(`python ${py.stdout.trim()} matches PYTHON_RUNTIME_VERSION ${python}`);
  }
  return passed;
}

async function stepImports({ image }) {
  const { pins } = await loadTables();
  let passed = true;
  const check = await inImage(image, ['pip', 'check']);
  if (check.code !== 0) {
    passed = fail(
      `DOES NOT CO-INSTALL — \`pip check\` found broken requirements in ${image}:\n  ${(check.stdout + check.stderr).trim().split('\n').join('\n  ')}`,
    );
  } else {
    ok(`pip check: ${check.stdout.trim()}`);
  }
  // One interpreter, every import, so a failure names each package it hits.
  const program = [
    'import importlib',
    `for name in ${JSON.stringify(pins.map((p) => p.name))}:`,
    '    try:',
    '        importlib.import_module(name)',
    '    except Exception as exc:',
    '        print(f"{name}: {type(exc).__name__}: {exc}")',
  ].join('\n');
  const imp = await inImage(image, ['python', '-c', program]);
  const failures = imp.stdout.trim();
  if (imp.code !== 0 || failures !== '') {
    passed = fail(
      `DOES NOT IMPORT — in ${image}:\n  ${(failures || imp.stderr.trim()).split('\n').join('\n  ')}`,
    );
  }
  if (passed) ok(`every pinned package imports: ${pins.map((p) => p.name).join(', ')}`);
  return passed;
}

async function stepUser({ image }) {
  const id = await inImage(image, ['id']);
  const uid = await inImage(image, ['id', '-u']);
  if (uid.code !== 0) return fail(`\`id -u\` exited ${uid.code} in ${image}: ${uid.stderr.trim()}`);
  const problem = userProblem(uid.stdout);
  if (problem) return fail(`RUNS AS ROOT — ${problem} (id: ${id.stdout.trim()})`);
  return ok(`the default user is not root: ${id.stdout.trim()}`);
}

async function stepFontCache({ image }) {
  // The control first: an empty cache directory must make the probe log the
  // rebuild, or the probe cannot see one and its silence below means nothing.
  const control = await inImage(image, ['python', '-c', FONT_PROBE], [
    '-e',
    'MPLCONFIGDIR=/tmp/mpl-empty-cache-control',
  ]);
  const controlOut = control.stdout + control.stderr;
  if (control.code !== 0) {
    return fail(
      `the font-cache probe could not import matplotlib.pyplot in ${image} (exit ${control.code}), so no cache can be read at all:\n${controlOut.trim()}`,
    );
  }
  if (!controlOut.includes(FONT_REBUILD_LINE)) {
    return fail(
      `the font-cache probe did not log "${FONT_REBUILD_LINE}" against an EMPTY cache, so it cannot see a rebuild and a quiet run would prove nothing. Output:\n${controlOut.trim()}`,
    );
  }
  ok(`control: against an empty cache the probe logs "${FONT_REBUILD_LINE}"`);

  // The reading: a fresh container, the image's default user, its own cache.
  const probe = await inImage(image, ['python', '-c', FONT_PROBE]);
  const out = probe.stdout + probe.stderr;
  if (probe.code !== 0) {
    return fail(
      `the font-cache probe could not import matplotlib.pyplot in ${image} (exit ${probe.code}), so the cache was not read at all:\n${out.trim()}`,
    );
  }
  const signals = coldCacheSignals(out);
  if (signals.length > 0) {
    return fail(
      `COLD FONT CACHE — importing matplotlib.pyplot as the image's default user rebuilt the font cache (logged: ${signals.map((s) => `"${s}"`).join(', ')}). The warm step must run AS that user, after \`USER\`. Output:\n${out.trim()}`,
    );
  }
  return ok(`the font cache is warm for the default user: no "${FONT_REBUILD_LINE}" at INFO`);
}

async function stepParity({ image }) {
  const { pins } = await loadTables();
  const work = mkdtempSync(path.join(tmpdir(), 'executor-parity-'));
  const out = path.join(work, 'parity-container.json');
  try {
    // The fixture makes no network call; the two notebook API variables are
    // removed so none can reach the container's command line from here.
    const env = { ...process.env, EXECUTOR_CONTAINER_IMAGE: image };
    delete env.SOCRATA_APP_TOKEN;
    delete env.DC_API_KEY;
    const result = await run(
      process.execPath,
      [
        '--no-warnings',
        '--experimental-strip-types',
        'scripts/executor-parity.mjs',
        'run',
        '--driver',
        'container',
        '--out',
        out,
      ],
      { env },
    );
    if (result.code !== 0) {
      return fail(`PARITY NOTEBOOK FAILED — scripts/executor-parity.mjs exited ${result.code} on ${image}`);
    }
    const normalized = JSON.parse(readFileSync(out, 'utf8'));
    const printed = normalized.notebook.cells
      .flatMap((cell) => cell.outputs ?? [])
      .filter((o) => o.output_type === 'stream')
      .map((o) => (Array.isArray(o.text) ? o.text.join('') : o.text))
      .join('');
    // The fixture prints `<name> <version>` for the libraries it imports.
    const reported = pins
      .map((p) => ({ ...p, printed: new RegExp(`^${p.name} (\\S+)$`, 'm').exec(printed)?.[1] }))
      .filter((p) => p.printed !== undefined);
    const wrong = reported.filter((p) => p.printed !== p.version);
    if (reported.length === 0 || wrong.length > 0) {
      return fail(
        `the parity notebook ran, but the kernel reported ${
          wrong.length > 0
            ? wrong.map((p) => `${p.name} ${p.printed} (pinned ${p.version})`).join(', ')
            : 'no pinned version at all'
        }. Printed:\n${printed.trim()}`,
      );
    }
    return ok(
      `the parity notebook executed in ${image}; the kernel reported ${reported.map((p) => `${p.name} ${p.printed}`).join(', ')}`,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** The checks run after the build, in order; CI runs each as its own step. */
export const CHECKS = ['pins', 'imports', 'user', 'font-cache', 'parity'];

const STEPS = {
  build: stepBuild,
  pins: stepPins,
  imports: stepImports,
  user: stepUser,
  'font-cache': stepFontCache,
  parity: stepParity,
};

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      image: { type: 'string', default: DEFAULT_IMAGE },
      dockerfile: { type: 'string', default: DEFAULT_DOCKERFILE },
    },
  });
  const [step] = positionals;
  const opts = { image: values.image, dockerfile: path.resolve(REPO_ROOT, values.dockerfile) };
  if (step === 'all') {
    if (!(await stepBuild(opts))) process.exit(1);
    const failed = [];
    for (const name of CHECKS) {
      console.log(`\n=== ${name}`);
      if (!(await STEPS[name](opts))) failed.push(name);
    }
    console.log(`\n=== ${failed.length === 0 ? 'all checks passed' : `FAILED: ${failed.join(', ')}`}`);
    process.exit(failed.length === 0 ? 0 : 1);
  }
  if (!(step in STEPS)) {
    console.error(`usage: executor-image-check.mjs <${[...Object.keys(STEPS), 'all'].join('|')}> [--image <tag>] [--dockerfile <path>]`);
    process.exit(2);
  }
  process.exit((await STEPS[step](opts)) ? 0 : 1);
}

// Run only as a program, so the test file can import the readings above.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.log(`::error::executor-image-check crashed: ${err instanceof Error ? err.stack ?? err.message : err}`);
    process.exit(1);
  });
}
