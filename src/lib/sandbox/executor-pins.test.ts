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
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { EXECUTOR_TOOLING_PACKAGES, SANDBOX_SDK_MAJOR } from './driver.ts';

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

test('the executor image runs the notebook as a non-root user', () => {
  assert.match(
    executorDockerfile,
    /^USER\s+(?!root\b)\S+/m,
    'docker/executor/Dockerfile declares no non-root USER, so the one place model-written code runs ' +
      'runs it as root',
  );
});

test('the font cache is warmed AFTER the USER switch, as the user that runs', () => {
  const userLine = executorDockerfile.search(/^USER\s+\S+/m);
  const warmLine = executorDockerfile.search(/^RUN\s+python\s+-c\s+"import matplotlib\.pyplot"/m);
  assert.notEqual(userLine, -1, 'no USER instruction');
  assert.notEqual(warmLine, -1, 'no matplotlib font-cache warm step');
  assert.ok(
    userLine < warmLine,
    'the font cache is warmed BEFORE the USER switch, so it is built under root\'s home and the ' +
      'running user rebuilds it on the first notebook. Measured against a decoy image in that ' +
      'order at matplotlib 3.9.2, the rebuild logs "generated new fontManager" at INFO: at default ' +
      'log levels that reaches nothing, and in a notebook that raises the log level (as the probe ' +
      'cell did) it lands in cell stderr, which is part of the signed executed-notebook bytes',
  );
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

test('the executor image tag agrees at every site that names it', () => {
  // Six files, seven occurrences. docs/deploy.md is the site the phase
  // contract's five-site census missed: an operator builds the image from the
  // deploy doc's tag, so a doc left at the old tag names an image with the
  // old, unpinned tooling under a tag the code no longer runs.
  // A version is [A-Za-z0-9._-]+ and nothing else. An open-ended class picks
  // up the ")" that closes the preflight row's prose and reports a tag that
  // disagrees with itself — which is how this assertion first failed.
  const sites = [
    'src/lib/sandbox/container.ts',
    'docker-compose.yml',
    'scripts/preflight-env.mjs',
    'docker/executor/Dockerfile',
    'docs/deploy.md',
  ];
  const tagPattern = /civic-notebook-executor:([A-Za-z0-9._-]+)/g;
  const found = new Set<string>();
  let occurrences = 0;
  for (const path of sites) {
    const all = [...repoFile(path).matchAll(tagPattern)].map((m) => m[1]);
    assert.ok(all.length > 0, `${path} names no executor image tag`);
    occurrences += all.length;
    for (const v of all) found.add(v);
  }
  assert.equal(
    found.size,
    1,
    `the executor image tag disagrees across its sites: ${[...found].join(', ')} — an operator's ` +
      'already-built image would keep the old tooling under a tag the code still names',
  );
  assert.ok(occurrences >= 6, `expected at least 6 tagged occurrences, found ${occurrences}`);
});
