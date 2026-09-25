// Executor pin guard (#450, Wave N12 W3). Grown from the red instrument the
// phase inherited: five of its assertions failed (or, for the tag control,
// passed) on run 35351830761 before this phase's change.
//
// WHY VERSIONS AND NOT NAMES. `./container.test.ts` asserts that the executor
// image installs each tooling package BY NAME. That check passed against
// `jupyter ipykernel nbformat nbconvert` with no version at all, which is
// exactly the state #450 was filed about: an executed notebook's bytes come
// out of nbformat and nbconvert and land in a signed package, so two builds
// on different days can sign different bytes for the same inputs. Measured
// 2026-09-18, a build of the pre-change image resolved nbformat 5.11.1 /
// ipykernel 7.3.0 / nbclient 0.11.0 where the reference deployment's snapshot
// holds 5.10.4 / 7.2.0 / 0.10.4 — the drift is real, not hypothetical.
// These assertions are on versions.
//
// WHAT THIS FILE DOES NOT COVER. It reads files, not a built image: it cannot
// see what `pip` resolved for a TRANSITIVE dependency (jupyter-core,
// jupyter-client, nbclient, traitlets), and those still float. The phase
// record states the transitive versions measured in the built image.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_CONTAINER_IMAGE } from './container.ts';
import { EXECUTOR_LAMBDA_RUNTIME_PACKAGES, EXECUTOR_TOOLING_PACKAGES, SANDBOX_SDK_MAJOR } from './driver.ts';

const repoFile = (p: string): string =>
  readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');
const executorDockerfile = repoFile('docker/executor/Dockerfile');

/** The version the shared table declares for a package. */
function declaredVersion(name: string): string | undefined {
  return (EXECUTOR_TOOLING_PACKAGES as Record<string, string>)[name];
}

test('every notebook-tooling package is pinned in the executor image', () => {
  for (const name of Object.keys(EXECUTOR_TOOLING_PACKAGES)) {
    assert.match(
      executorDockerfile,
      new RegExp(`(^|[\\s\\\\])${name}==\\d[^\\s\\\\]*`, 'm'),
      `docker/executor/Dockerfile installs "${name}" with no version. An executed notebook's bytes ` +
        'come out of nbformat and nbconvert and go into a signed package, so two builds of this ' +
        'image on different days can sign different bytes for the same inputs',
    );
  }
});

test('the tooling versions are single-sourced, not written twice', () => {
  for (const name of Object.keys(EXECUTOR_TOOLING_PACKAGES)) {
    const declared = declaredVersion(name);
    assert.ok(
      typeof declared === 'string' && declared.length > 0,
      `the shared tooling table declares no version for "${name}", so the image and the sandbox ` +
        'path cannot be checked against one source — which is the drift #450 is about',
    );
    const inImage = new RegExp(`(^|[\\s\\\\])${name}==([^\\s\\\\]+)`, 'm').exec(executorDockerfile);
    assert.notEqual(inImage, null, `the image pins no version for "${name}"`);
    assert.equal(
      inImage![2],
      declared,
      `the image pins ${name}==${inImage![2]} while the shared table declares ${declared}`,
    );
  }
});

/** One build stage of the executor Dockerfile: what it builds FROM, its name, and its text. */
interface Stage {
  base: string;
  name: string | null;
  start: number;
  text: string;
}

function stages(): Stage[] {
  const froms = [...executorDockerfile.matchAll(/^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/gim)];
  assert.ok(froms.length > 0, 'docker/executor/Dockerfile has no FROM instruction to read a stage from');
  return froms.map((m, i) => ({
    base: m[1],
    name: m[2] ?? null,
    start: m.index,
    text: executorDockerfile.slice(m.index, froms[i + 1]?.index ?? executorDockerfile.length),
  }));
}

/**
 * The instructions an image built from `stage` carries: the stage and every
 * earlier stage it builds FROM, base first (#530: the default target and the
 * lambda target both build on `executor`). A stage it does not build on does
 * not carry into it, so every assertion below reads a chain, never the file.
 */
function chainText(stage: Stage): string {
  const all = stages();
  const chain = [stage];
  for (let cur = stage; ; ) {
    const parent = all.find((s) => s.name !== null && s.name === cur.base && s.start < cur.start);
    if (!parent) break;
    chain.unshift(parent);
    cur = parent;
  }
  return chain.map((s) => s.text).join('');
}

/** The image `docker build docker/executor` produces: the last stage's chain. */
function finalStage(): string {
  const all = stages();
  return chainText(all[all.length - 1]);
}

/** The lambda target's chain (#530), which `docker build --target lambda` produces. */
function lambdaStage(): string {
  const lambda = stages().find((s) => s.name === 'lambda');
  assert.ok(lambda, 'docker/executor/Dockerfile has no `lambda` stage for EXECUTOR_DRIVER=lambda to build');
  return chainText(lambda);
}

/** Every `USER` instruction of the final stage, in order, with its offset. */
function userInstructions(text = finalStage()): { user: string; index: number }[] {
  return [...text.matchAll(/^USER\s+(\S+)/gm)].map((m) => ({ user: m[1], index: m.index }));
}

test('the executor image runs the notebook as a non-root user', () => {
  // THE LAST `USER` is the one the container runs as. An earlier non-root
  // `USER` followed by `USER root` runs as root, so a match anywhere in the
  // file is not the property (cold read F6, #470).
  const users = userInstructions();
  assert.ok(
    users.length > 0,
    'docker/executor/Dockerfile declares no USER in its final stage, so the one place model-written ' +
      'code runs runs it as root',
  );
  const last = users[users.length - 1].user;
  assert.doesNotMatch(
    last,
    /^(root|0)(:.*)?$/,
    `the final stage's last USER instruction is "${last}", so the image runs the notebook as root ` +
      'whatever an earlier USER line says',
  );
});

test('the font cache is warmed AFTER the last USER switch, as the user that runs', () => {
  // Read over the default image's chain: the warm is in the shared `executor`
  // stage, and the default stage restates the same USER after it (#530). What
  // matters is that the warm ran as the user the image runs as, and that no
  // USER after it names anyone else.
  const users = userInstructions();
  const warmLine = finalStage().search(/^RUN\s+python\s+-c\s+"import matplotlib\.pyplot"/m);
  assert.ok(users.length > 0, 'no USER instruction in the final stage');
  assert.notEqual(warmLine, -1, 'no matplotlib font-cache warm step in the final stage');
  const runsAs = users[users.length - 1].user;
  const warmedAs = users.filter((u) => u.index < warmLine).at(-1);
  const switchedAfter = users.filter((u) => u.index > warmLine && u.user !== runsAs);
  assert.ok(
    warmedAs !== undefined && warmedAs.user === runsAs && switchedAfter.length === 0,
    'the font cache is warmed BEFORE the last USER switch, so it is built under another user\'s home ' +
      'and the running user rebuilds it on the first notebook. Measured against a decoy image in that ' +
      'order at matplotlib 3.9.2, the rebuild logs "generated new fontManager" at INFO: at default ' +
      'log levels that reaches nothing, and in a notebook that raises the log level (as the probe ' +
      'cell did) it lands in cell stderr, which is part of the signed executed-notebook bytes',
  );
});

/** Every `name==version` pin a stage's own text installs. */
function pinsIn(text: string): Record<string, string> {
  return Object.fromEntries([...text.matchAll(/([a-zA-Z0-9_-]+)==([0-9][0-9a-zA-Z.]*)/g)].map((m) => [m[1], m[2]]));
}

test('the lambda target pins the runtime client at the table version, and the default image does not carry it', () => {
  // #530, ruling D4: the function's image is the container image's stack plus
  // the runtime interface client. The scientific and tooling pins come from
  // the shared stage, so environment.libraries is true of both images.
  const lambda = lambdaStage();
  for (const [name, version] of Object.entries(EXECUTOR_LAMBDA_RUNTIME_PACKAGES)) {
    assert.equal(pinsIn(lambda)[name], version, `the lambda target does not pin ${name}==${version}`);
    assert.equal(
      pinsIn(finalStage())[name],
      undefined,
      `the default image installs ${name}; the container driver's image must not carry the Lambda runtime`,
    );
  }
  for (const [name, version] of Object.entries(EXECUTOR_TOOLING_PACKAGES)) {
    assert.equal(pinsIn(lambda)[name], version, `the lambda target does not carry the tooling pin ${name}==${version}`);
  }
});

test('the lambda target runs the handler as the image user, through the runtime interface client', () => {
  const lambda = lambdaStage();
  const users = userInstructions(lambda);
  assert.ok(users.length > 0 && !/^(root|0)(:.*)?$/.test(users[users.length - 1].user), 'the lambda target runs as root');
  assert.match(lambda, /^COPY\s+lambda\/handler\.py\s+\/var\/task\/handler\.py$/m);
  assert.match(lambda, /^ENTRYPOINT\s+\["python",\s*"-m",\s*"awslambdaric"\]$/m);
  assert.match(lambda, /^CMD\s+\["handler\.handler"\]$/m);
});

test('the sandbox SDK major is named in the pin table and matches what is installed', () => {
  const require_ = createRequire(import.meta.url);
  const installed = (require_('@vercel/sandbox/package.json') as { version: string }).version;
  assert.equal(
    Number(installed.split('.')[0]),
    SANDBOX_SDK_MAJOR,
    `the table names @vercel/sandbox major ${SANDBOX_SDK_MAJOR} but ${installed} is installed — a ` +
      'floor test on the INSTALLED version is what keeps the named major honest. Card C6 requires ' +
      'it named and NOT upgraded: 2.x removes the sandbox instance id that flows into the ' +
      'execution-metadata stamp on published records, and 3.x moves the managed Python off the ' +
      'pinned 3.13',
  );
  const declared = (
    JSON.parse(repoFile('package.json')) as { dependencies: Record<string, string> }
  ).dependencies['@vercel/sandbox'];
  assert.equal(
    Number(/(\d+)/.exec(declared ?? '')?.[1]),
    SANDBOX_SDK_MAJOR,
    `package.json declares @vercel/sandbox ${declared}, whose major is not ${SANDBOX_SDK_MAJOR}`,
  );
});

/** The repository root, and this file's path relative to it. */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const THIS_FILE = relative(REPO_ROOT, fileURLToPath(import.meta.url));

/**
 * The files the executor image is built and run from. A derivation that
 * misses any of them saw less than the image's own sites, whatever it found
 * elsewhere: the Dockerfile's build instruction, the code's default tag, and
 * the compose default. This is a floor on the derivation, not the site list.
 */
const BUILT_AND_RUN_FROM = ['docker/executor/Dockerfile', 'src/lib/sandbox/container.ts', 'docker-compose.yml'];

/**
 * Every tracked file that names `civic-notebook-executor:<tag>`, with each
 * tag it names, derived from `git ls-files` and a search of each file rather
 * than typed here (cold read F2, #470): a hand list cannot see a site it
 * never listed. This test file is excluded; it names the pattern, not a tag.
 */
function executorTagSites(): Map<string, string[]> {
  const needle = 'civic-notebook-executor:';
  const tagPattern = /civic-notebook-executor:([A-Za-z0-9._-]*)/g;
  const sites = new Map<string, string[]>();
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((p) => p.length > 0 && p !== THIS_FILE);
  for (const path of tracked) {
    let text: string;
    try {
      text = readFileSync(`${REPO_ROOT}${path}`, 'utf8');
    } catch {
      continue; // a tracked path deleted in the working tree, or not a file
    }
    if (!text.includes(needle)) continue;
    sites.set(path, [...text.matchAll(tagPattern)].map((m) => m[1]));
  }
  return sites;
}

test('the executor image tag agrees at every tracked site that names it', () => {
  // docs/deploy.md is the site the phase contract's census missed in W3: an
  // operator builds the image from the deploy doc's tag, so a doc left at the
  // old tag names an image with the old, unpinned tooling under a tag the
  // code no longer runs.
  // A version is [A-Za-z0-9._-]+ and nothing else. An open-ended class picks
  // up the ")" that closes the preflight row's prose and reports a tag that
  // disagrees with itself — which is how this assertion first failed.
  const current = /^civic-notebook-executor:([A-Za-z0-9._-]+)$/.exec(DEFAULT_CONTAINER_IMAGE)?.[1];
  assert.ok(
    current,
    `DEFAULT_CONTAINER_IMAGE is "${DEFAULT_CONTAINER_IMAGE}", which names no civic-notebook-executor tag ` +
      'to compare the other sites against',
  );
  const sites = executorTagSites();
  assert.ok(
    sites.size > 0,
    'the derivation found no tracked file naming civic-notebook-executor:<tag>, so this test checked ' +
      'nothing — the search, not the tree, is what failed',
  );
  for (const path of BUILT_AND_RUN_FROM) {
    assert.ok(
      sites.has(path),
      `the derivation did not find ${path}, which the executor image is built or run from; it found ` +
        `${[...sites.keys()].join(', ')}, so it saw less than the image's own sites`,
    );
  }
  for (const [path, tags] of sites) {
    for (const tag of tags) {
      assert.equal(
        tag,
        current,
        `${path} names civic-notebook-executor:${tag || '(no tag)'} while the code runs ` +
          `${DEFAULT_CONTAINER_IMAGE} — an operator's already-built image would keep the old tooling ` +
          'under a tag the code still names',
      );
    }
  }
});
