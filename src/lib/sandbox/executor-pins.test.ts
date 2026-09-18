// RED INSTRUMENT for Wave N12 phase W3 (#450), anchor #470.
//
// Five assertions. Four fail at `d34d2fd`; the fifth passes today and is the
// control — the executor image tag already agrees at all five of its sites, and
// it must still agree after the bump this phase makes.
//
// WHY VERSIONS AND NOT NAMES. `src/lib/sandbox/container.test.ts` already asserts
// that the Dockerfile installs each tooling package BY NAME. That check passes
// against `jupyter ipykernel nbformat nbconvert` with no version at all, which is
// exactly the state #450 was filed about: an executed notebook's bytes come out of
// nbformat and nbconvert and land in a signed package, so two builds on different
// days can sign different bytes for the same inputs. These assertions are on
// versions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { EXECUTOR_TOOLING_PACKAGES } from './driver.ts';

const repoFile = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');
const executorDockerfile = repoFile('docker/executor/Dockerfile');

/** The four tooling package names, whatever shape the table is in. */
function toolingNames(): string[] {
  return Array.isArray(EXECUTOR_TOOLING_PACKAGES)
    ? [...EXECUTOR_TOOLING_PACKAGES]
    : Object.keys(EXECUTOR_TOOLING_PACKAGES as unknown as Record<string, string>);
}

/** The version the shared table declares for a package, or null if it declares none. */
function declaredVersion(name: string): string | null {
  if (Array.isArray(EXECUTOR_TOOLING_PACKAGES)) return null;
  const v = (EXECUTOR_TOOLING_PACKAGES as unknown as Record<string, string>)[name];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

test('every notebook-tooling package is pinned in the executor image', () => {
  for (const name of toolingNames()) {
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
  for (const name of toolingNames()) {
    const declared = declaredVersion(name);
    assert.notEqual(
      declared,
      null,
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

test('the sandbox SDK major is named in the pin table and matches what is installed', () => {
  const declaredMajor = /@vercel\/sandbox[^\n]*?\bmajor\b[^\n]*?(\d+)/i.exec(executorDockerfile)
    ?? /SANDBOX_SDK_MAJOR\s*=\s*['"`]?(\d+)/.exec(repoFile('src/lib/sandbox/driver.ts'));
  assert.notEqual(
    declaredMajor,
    null,
    'nothing names the @vercel/sandbox major. Card C7 requires it named beside the tooling versions ' +
      'and NOT upgraded: 2.x removes the sandbox instance id that flows into the execution-metadata ' +
      'stamp on published records, and 3.x moves the managed Python off the pinned 3.13',
  );
  const require_ = createRequire(import.meta.url);
  const installed = require_('@vercel/sandbox/package.json').version as string;
  assert.equal(
    installed.split('.')[0],
    declaredMajor![1],
    `the table names major ${declaredMajor![1]} but @vercel/sandbox ${installed} is installed — a ` +
      'floor test on the installed version is what keeps the named major honest',
  );
});

test('the executor image tag agrees at every site that names it', () => {
  const sites: Array<[string, RegExp]> = [
    // A version is [A-Za-z0-9._-]+ and nothing else. An open-ended class picks
    // up the ")" that closes the preflight row's prose and reports a tag that
    // disagrees with itself — which is how this assertion first failed.
    ['src/lib/sandbox/container.ts', /civic-notebook-executor:([A-Za-z0-9._-]+)/],
    ['docker-compose.yml', /civic-notebook-executor:([A-Za-z0-9._-]+)/],
    ['scripts/preflight-env.mjs', /civic-notebook-executor:([A-Za-z0-9._-]+)/],
    ['docker/executor/Dockerfile', /civic-notebook-executor:([A-Za-z0-9._-]+)/],
  ];
  const found = new Set<string>();
  for (const [path, re] of sites) {
    const text = repoFile(path);
    const all = [...text.matchAll(new RegExp(re.source, 'g'))].map((m) => m[1]);
    assert.ok(all.length > 0, `${path} names no executor image tag`);
    for (const v of all) found.add(v.replace(/^civic-notebook-executor:/, ''));
  }
  assert.equal(
    found.size,
    1,
    `the executor image tag disagrees across its sites: ${[...found].join(', ')} — an operator's ` +
      'already-built image would keep the old tooling under a tag the code still names',
  );
});
