// A build behind a registry mirror edits no Dockerfile. A deployment whose
// build hosts reach neither Docker Hub nor PyPI pulls through a mirror
// instead, and it can redirect only what a build argument names. Over every
// Dockerfile docker-compose.yml builds (the application image and the
// notebook image, found from the compose file's `build:` sections rather than
// listed here), this file asserts three properties:
//
//   1. No `syntax` parser directive. One makes the builder pull a frontend
//      image from Docker Hub before it reads the file, and no build argument
//      reaches that pull.
//   2. Every image a build pulls is named by a global ARG. Each FROM, and each
//      `COPY --from=` / `RUN --mount=…from=`, names either an earlier stage or
//      `${NAME}` for an ARG declared ahead of the first FROM, the only scope a
//      FROM reads.
//   3. Every RUN that runs `pip install` follows an `ARG PIP_INDEX_URL` in its
//      own stage, and no ARG gives it a default. Docker documents an ARG as
//      out of scope at the end of its stage. BuildKit (measured at v0.29)
//      carries the value into a stage built FROM the declaring one anyway,
//      but the legacy builder does not, and there a stage without its own
//      declaration reaches PyPI behind a mirror (measured on the notebook
//      image's `lambda` stage). A default would put an index into the
//      reference build, which uses pip's own.
//
// CI reaches Docker Hub and PyPI directly, so a build that ignores a mirror
// is green there. These assertions are where it goes red.
//
// BLIND SPOTS, stated. This file reads text and builds nothing. It sees a pull
// only through FROM and `from=`: a RUN that downloads by other means (curl,
// apt-get, npm) is invisible to it, and the application image's `npm ci`
// reaches the npm registry, which no build argument covers yet. It cannot see
// whether an ARG's default is the right image (src/lib/sandbox/container.test.ts
// pins the notebook image's Python version) or whether a mirror serves the same
// image. It recognises pip as `pip install`, `pip3 install` or `python -m pip
// install` in a RUN; an installer spelled any other way is not read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';

import { parseComposeService, parseDockerfile } from './check-compose-env.mjs';

const repoFile = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

/** The images an operator builds. A derivation that misses one saw less than the repository builds. */
const BUILT = ['Dockerfile', 'docker/executor/Dockerfile'];

/** Every Dockerfile a service in docker-compose.yml builds, from its `build:` context and `dockerfile:`. */
function composeDockerfiles() {
  const compose = repoFile('docker-compose.yml');
  const lines = compose.split('\n');
  const at = lines.findIndex((line) => /^services:\s*$/.test(line));
  assert.notEqual(at, -1, 'docker-compose.yml has no top-level `services:` key to read builds from');
  const services = [];
  for (const line of lines.slice(at + 1)) {
    if (/^[^\s#]/.test(line)) break; // the next top-level key
    const service = /^ {2}([A-Za-z0-9_.-]+):\s*$/.exec(line);
    if (service) services.push(service[1]);
  }
  const paths = new Set();
  for (const service of services) {
    const { build } = parseComposeService(compose, service);
    if (build) paths.add(posix.join(build.context ?? '.', build.dockerfile ?? 'Dockerfile'));
  }
  return [...paths];
}

const dockerfiles = composeDockerfiles();

test('the derivation finds every Dockerfile the repository builds', () => {
  for (const path of BUILT) {
    assert.ok(
      dockerfiles.includes(path),
      `the compose derivation did not find ${path}; it found ${dockerfiles.join(', ') || 'nothing'}, so ` +
        'every assertion below saw less than the images an operator builds',
    );
  }
});

/** The parser directives: the `# key=value` lines ahead of any other line. */
function parserDirectives(text) {
  const directives = [];
  for (const line of text.split('\n')) {
    const m = /^#\s*([A-Za-z][A-Za-z0-9]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) break;
    directives.push({ key: m[1].toLowerCase(), value: m[2] });
  }
  return directives;
}

test('no Dockerfile pulls a frontend image through a syntax directive', () => {
  for (const path of dockerfiles) {
    const syntax = parserDirectives(repoFile(path)).find((d) => d.key === 'syntax');
    assert.equal(
      syntax,
      undefined,
      `${path} sets \`# syntax=${syntax?.value}\`, so every build pulls that frontend image from its ` +
        'registry before reading the file, and a build behind a mirror has to edit the file to stop it',
    );
  }
});

test('every image a build pulls is named by a build argument', () => {
  for (const path of dockerfiles) {
    const { globalArgs, stages } = parseDockerfile(repoFile(path));
    const globalNames = new Set(globalArgs.map((a) => a.name.toLowerCase()));
    for (const [i, stage] of stages.entries()) {
      const earlier = stages.slice(0, i);
      const isEarlierStage = (ref) =>
        earlier.some((s) => s.name === ref.toLowerCase()) || (/^\d+$/.test(ref) && Number(ref) < i);
      const refs = [
        { ref: stage.from, where: `the FROM at line ${stage.line}` },
        ...stage.needs.map((ref) => ({ ref, where: `a \`from=\` in stage "${stage.name ?? i}"` })),
      ];
      for (const { ref, where } of refs) {
        const arg = /^\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))$/.exec(ref);
        const named = arg !== null && globalNames.has((arg[1] ?? arg[2]).toLowerCase());
        assert.ok(
          isEarlierStage(ref) || named,
          `${path}: ${where} pulls "${ref}", which is neither an earlier stage nor a build argument ` +
            'declared ahead of the first FROM, so a build behind a registry mirror has to edit the file to ' +
            'redirect it',
        );
      }
    }
  }
});

const PIP_INSTALL = /\bpip(?:3(?:\.\d+)?)?\s+install\b/;

test('every pip install reads PIP_INDEX_URL, declared in its own stage with no default', () => {
  const installing = [];
  for (const path of dockerfiles) {
    const text = repoFile(path);
    const withDefault = /^\s*ARG\s+(?:.*\s)?PIP_INDEX_URL=.*$/m.exec(text);
    assert.equal(
      withDefault,
      null,
      `${path} gives PIP_INDEX_URL a default (${withDefault?.[0].trim()}), so a build that passes nothing ` +
        "puts that index in every pip install's environment in place of pip's own, and is not the reference build",
    );
    for (const stage of parseDockerfile(text).stages) {
      const installs = stage.runs.filter((run) => PIP_INSTALL.test(run.command));
      if (installs.length === 0) continue;
      installing.push(`${path} ${stage.name}`);
      const declared = stage.args.filter((a) => a.name === 'PIP_INDEX_URL');
      for (const run of installs) {
        assert.ok(
          declared.some((a) => a.line < run.line),
          `${path} line ${run.line} runs pip install in stage "${stage.name}" with no ARG PIP_INDEX_URL ` +
            'declared ahead of it in that stage. An ARG is documented as out of scope at the end of its ' +
            'stage; under a builder that keeps to that, this install reaches PyPI behind a registry mirror',
        );
      }
    }
  }
  for (const expected of ['docker/executor/Dockerfile executor', 'docker/executor/Dockerfile lambda']) {
    assert.ok(
      installing.includes(expected),
      `found no pip install in ${expected}, which installs the notebook image's pins; the search, not the ` +
        `file, is what failed (found: ${installing.join(', ') || 'none'})`,
    );
  }
});
