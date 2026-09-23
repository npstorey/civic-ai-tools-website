// The readings scripts/executor-image-check.mjs makes of a built executor
// image, and the CI job that runs it (#490).
//
// WHAT THIS FILE COVERS. The pure readings: how `pip freeze` is compared with
// the pin tables, how `id -u` is read, which lines count as a cold font cache,
// and how a failed build is named. Each is driven with the output the real
// image produced — at the base commit and under the sabotaged Dockerfiles the
// phase record lists — so every assertion here has a shape that fails it.
// It also reads the `executor image build` job in ci.yml: that the job runs
// the build and every check, that no check is skipped because another failed,
// and that the job carries no paths filter.
//
// BLIND SPOTS, stated. It builds no image and runs no container. Whether the
// image passes is the CI job's reading, on the runner; this file only says the
// readings would fail on the shapes that should fail them. The ci.yml reader is
// line-oriented, like scripts/image-variant-and-readonly-root.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { PINNED_LIBRARIES } from '../src/lib/notebook-author/prompt.ts';
import { EXECUTOR_TOOLING_PACKAGES } from '../src/lib/sandbox/driver.ts';
import {
  CHECKS,
  FONT_REBUILD_LINE,
  TEMP_CACHE_LINE,
  classifyBuildFailure,
  coldCacheSignals,
  comparePins,
  expectedPins,
  parseFreeze,
  userProblem,
} from './executor-image-check.mjs';

const pins = expectedPins(PINNED_LIBRARIES, EXECUTOR_TOOLING_PACKAGES);

/** A `pip freeze` in the shape the image printed at the base commit, pins at their table versions. */
function freezeAtTables(overrides = {}) {
  const lines = [
    'anyio==4.15.1',
    'jupyter_client==8.10.0',
    'jupyter_core==5.9.1',
    'MarkupSafe==3.0.3',
    'python-dateutil==2.9.0.post0',
  ];
  for (const { name, version } of pins) {
    if (overrides[name] === null) continue;
    lines.push(`${name}==${overrides[name] ?? version}`);
  }
  return lines.sort().join('\n');
}

test('the expected pins are every entry of both tables, read from them', () => {
  assert.equal(
    pins.length,
    Object.keys(PINNED_LIBRARIES).length + Object.keys(EXECUTOR_TOOLING_PACKAGES).length,
  );
  for (const [name, version] of Object.entries({ ...PINNED_LIBRARIES, ...EXECUTOR_TOOLING_PACKAGES })) {
    assert.ok(
      pins.some((p) => p.name === name && p.version === version),
      `${name}==${version} is in a pin table but not among the versions the image is checked for`,
    );
  }
});

test('a freeze carrying every pin at its table version passes', () => {
  assert.deepEqual(comparePins(pins, parseFreeze(freezeAtTables())), []);
});

test('a changed pin is named with both versions and the table that holds it', () => {
  const problems = comparePins(pins, parseFreeze(freezeAtTables({ requests: '2.32.2' })));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^requests: expected 2\.32\.3 .*PINNED_LIBRARIES.*requests==2\.32\.2$/);
});

test('a dropped pin reads as absent, or as a mismatch when something else pulls it in', () => {
  const absent = comparePins(pins, parseFreeze(freezeAtTables({ pandas: null })));
  assert.deepEqual(absent.length, 1);
  assert.match(absent[0], /^pandas: .*no pandas at all$/);
  // nbformat dropped from the pin list still arrives through nbconvert, at
  // whatever PyPI's newest is.
  const pulled = comparePins(pins, parseFreeze(freezeAtTables({ nbformat: '9.9.9' })));
  assert.match(pulled[0], /^nbformat: expected .*EXECUTOR_TOOLING_PACKAGES.*nbformat==9\.9\.9$/);
});

test('project names are compared as PEP 503 normalises them', () => {
  const freeze = parseFreeze('Jupyter_Client==8.10.0\nnb.format==1\n');
  assert.equal(freeze.get('jupyter-client'), '8.10.0');
  assert.deepEqual(
    comparePins([{ name: 'jupyter-client', version: '8.10.0', source: 't' }], freeze),
    [],
  );
});

test('an empty freeze reports every pin, never a pass', () => {
  assert.equal(comparePins(pins, parseFreeze('')).length, pins.length);
});

test('uid 0 is root; the image user is not; anything else is not a uid', () => {
  assert.match(userProblem('0\n'), /uid 0 \(root\)/);
  assert.equal(userProblem('10001\n'), null);
  assert.match(userProblem(''), /not a uid/);
  assert.match(userProblem('root'), /not a uid/);
});

test('both cold-cache lines are read, from the output the sabotaged images printed', () => {
  // Warm step moved above USER (after ENV): the cache dir is root-owned.
  const aboveUser =
    'WARNING:matplotlib:Matplotlib created a temporary cache directory at /tmp/matplotlib-6vt7n6yx ' +
    'because the default path (/home/notebook/.config/matplotlib) is not a writable directory\n' +
    'INFO:matplotlib.font_manager:generated new fontManager\n';
  assert.deepEqual(coldCacheSignals(aboveUser), [FONT_REBUILD_LINE, TEMP_CACHE_LINE]);
  // Warm step moved above ENV: the cache went to root's home.
  assert.deepEqual(coldCacheSignals('INFO:matplotlib.font_manager:generated new fontManager\n'), [
    FONT_REBUILD_LINE,
  ]);
  // The base image: the probe prints nothing.
  assert.deepEqual(coldCacheSignals(''), []);
});

test('a failed build is named by its cause', () => {
  const conflict =
    "ERROR: Cannot install nbconvert==7.17.1 and nbformat==5.1.3 because these package versions have conflicting dependencies.\n" +
    'ERROR: ResolutionImpossible: for help visit https://pip.pypa.io/en/latest/topics/dependency-resolution/';
  assert.match(classifyBuildFailure(conflict), /does not co-install/);

  const warmImport =
    '#8 [5/5] RUN python -c "import matplotlib.pyplot"\n' +
    "#8 0.412 ModuleNotFoundError: No module named 'pyparsing'";
  assert.match(classifyBuildFailure(warmImport), /does not import/);

  // Measured during an outage: pip's unreachable index must not read as a conflict.
  const outage =
    "WARNING: Retrying ... Failed to establish a new connection: [Errno 101] Network is unreachable\n" +
    'ERROR: Could not find a version that satisfies the requirement pandas==2.2.3 (from versions: none)';
  assert.match(classifyBuildFailure(outage), /could not reach a registry/);
  const token =
    'ERROR: failed to solve: failed to fetch anonymous token: Get "https://auth.docker.io/token": dial tcp: connect: connection refused';
  assert.match(classifyBuildFailure(token), /could not reach a registry/);

  assert.match(classifyBuildFailure('something else'), /did not build/);
});

// --- the CI job ---------------------------------------------------------------

const ciWorkflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

/** The `executor image build` job's body, found by its name. */
function executorJob() {
  const lines = ciWorkflow.split('\n');
  const nameAt = lines.findIndex((l) => /^\s{4}name:\s*executor image build\s*$/.test(l));
  assert.notEqual(nameAt, -1, '.github/workflows/ci.yml declares no job named "executor image build"');
  let jobAt = nameAt;
  while (jobAt >= 0 && !/^ {2}\S.*:\s*$/.test(lines[jobAt])) jobAt -= 1;
  const rest = lines.slice(jobAt + 1);
  const end = rest.findIndex((l) => /^ {2}\S/.test(l));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

/** Each `- name:` step with its `if:` and `run:` lines. */
function jobSteps() {
  const steps = [];
  for (const line of executorJob().split('\n')) {
    const name = /^ {6}- name:\s*(.+)$/.exec(line);
    if (name || /^ {6}- uses:/.test(line)) steps.push({ name: name?.[1] ?? line.trim(), if: null, run: null });
    const cond = /^ {8}if:\s*(.+)$/.exec(line);
    if (cond) steps[steps.length - 1].if = cond[1];
    const run = /^ {8}run:\s*(.+)$/.exec(line);
    if (run) steps[steps.length - 1].run = run[1];
  }
  return steps;
}

test('the job runs the build and then every check the script defines, each as a step', () => {
  const invoked = jobSteps()
    .map((s) => /scripts\/executor-image-check\.mjs (\S+)$/.exec(s.run ?? '')?.[1])
    .filter(Boolean);
  assert.deepEqual(invoked, ['build', ...CHECKS]);
});

test('each check runs whenever the build succeeded, whatever another check did', () => {
  const steps = jobSteps().filter((s) => /executor-image-check\.mjs (?!build)/.test(s.run ?? ''));
  assert.equal(steps.length, CHECKS.length);
  for (const step of steps) {
    assert.equal(
      step.if,
      "${{ !cancelled() && steps.build.outcome == 'success' }}",
      `"${step.name}" does not run on its own after a green build, so one red check would hide the next`,
    );
  }
  assert.match(executorJob(), /^ {8}id: build$/m, 'the build step carries no `id: build` for the checks to read');
});

test('the job is always-run and credential-free', () => {
  const job = executorJob();
  assert.doesNotMatch(ciWorkflow, /^\s*paths(-ignore)?:/m, 'ci.yml carries a paths filter');
  assert.doesNotMatch(job, /secrets\./, 'the executor job references a secret');
  assert.doesNotMatch(job, /^\s*env:/m, 'the executor job declares an env block');
  assert.doesNotMatch(job, /docker login|--password/, 'the executor job logs in to a registry');
});
