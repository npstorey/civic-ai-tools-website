// A build behind a registry mirror edits no Dockerfile. A deployment whose
// build hosts reach none of Docker Hub, PyPI and the npm registry pulls
// through a mirror instead, and it can redirect only what a build argument
// names. Over every Dockerfile docker-compose.yml builds (the application
// image and the notebook image, found from the compose file's `build:`
// sections rather than listed here), this file asserts three properties:
//
//   1. No `syntax` parser directive. One makes the builder pull a frontend
//      image from Docker Hub before it reads the file, and no build argument
//      reaches that pull.
//   2. Every image a build pulls is named by a global ARG. Each FROM, and each
//      `COPY --from=` / `RUN --mount=…from=`, names either an earlier stage or
//      `${NAME}` for an ARG declared ahead of the first FROM, the only scope a
//      FROM reads.
//   3. Every RUN that installs packages follows its installer's own variable,
//      declared in its own stage, and no ARG gives that variable a default:
//      `pip install` follows `ARG PIP_INDEX_URL`, and `npm ci` or
//      `npm install` follows `ARG NPM_CONFIG_REGISTRY`. Docker documents an
//      ARG as out of scope at the end of its stage. BuildKit (measured at
//      v0.29) carries the value into a stage built FROM the declaring one
//      anyway, but the legacy builder does not, and there a stage without its
//      own declaration reaches PyPI behind a mirror (measured on the notebook
//      image's `lambda` stage). A default would put an index into the
//      reference build, which uses the installer's own.
//
// CI reaches Docker Hub, PyPI and the npm registry directly, so a build that
// ignores a mirror is green there. These assertions are where it goes red.
//
// BLIND SPOTS, stated. This file reads text and builds nothing. It sees a pull
// only through FROM and `from=`, and an install only through the two
// installers below: a RUN that downloads by other means (curl, apt-get, a
// fetch inside `next build`) is invisible to it. It cannot see whether an
// ARG's default is the right image (src/lib/sandbox/container.test.ts pins the
// notebook image's Python version) or whether a mirror serves the same image.
// It recognises pip as `pip install`, `pip3 install` or `python -m pip
// install`, and npm as `npm ci` or `npm install` or one of npm 10's aliases for
// either, with the subcommand directly after `npm`. An installer spelled any
// other way (a flag ahead of the subcommand, `npx`, `npm exec`, yarn, pnpm) is
// not read.
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

/**
 * The installers a build runs, each with the variable that redirects it. `expected` names the stages
 * that install today, so a pattern that stops matching fails here rather than passing over nothing.
 */
const INSTALLERS = [
  {
    tool: 'pip',
    install: /\bpip(?:3(?:\.\d+)?)?\s+install\b/,
    arg: 'PIP_INDEX_URL',
    upstream: 'PyPI',
    expected: ['docker/executor/Dockerfile executor', 'docker/executor/Dockerfile lambda'],
    what: "the notebook image's pins",
  },
  {
    tool: 'npm',
    // `ci`, `install`, and npm 10's aliases for them (read from lib/utils/cmd-list.js in the base
    // image). `\b` ends the match at a hyphen, so `install-clean` and `install-ci-test` are read too.
    install: /\bnpm\s+(?:ci|ic|clean-install|install|add|i|in|ins|inst|insta|instal|isnt|isnta|isntal|isntall|it|cit|sit)\b/,
    arg: 'NPM_CONFIG_REGISTRY',
    upstream: 'the npm registry',
    expected: ['Dockerfile deps'],
    what: "the application's dependencies",
  },
];

for (const { tool, install, arg, upstream, expected, what } of INSTALLERS) {
  test(`every ${tool} install reads ${arg}, declared in its own stage with no default`, () => {
    const installing = [];
    for (const path of dockerfiles) {
      const text = repoFile(path);
      const withDefault = new RegExp(`^\\s*ARG\\s+(?:.*\\s)?${arg}=.*$`, 'm').exec(text);
      assert.equal(
        withDefault,
        null,
        `${path} gives ${arg} a default (${withDefault?.[0].trim()}), so a build that passes nothing puts ` +
          `that address in every ${tool} install's environment in place of ${tool}'s own, and is not the ` +
          'reference build',
      );
      for (const stage of parseDockerfile(text).stages) {
        const installs = stage.runs.filter((run) => install.test(run.command));
        if (installs.length === 0) continue;
        installing.push(`${path} ${stage.name}`);
        const declared = stage.args.filter((a) => a.name === arg);
        for (const run of installs) {
          assert.ok(
            declared.some((a) => a.line < run.line),
            `${path} line ${run.line} installs with ${tool} in stage "${stage.name}" with no ARG ${arg} ` +
              'declared ahead of it in that stage. An ARG is documented as out of scope at the end of its ' +
              `stage; under a builder that keeps to that, this install reaches ${upstream} behind a registry mirror`,
          );
        }
      }
    }
    for (const stage of expected) {
      assert.ok(
        installing.includes(stage),
        `found no ${tool} install in ${stage}, which installs ${what}; the search, not the file, is what ` +
          `failed (found: ${installing.join(', ') || 'none'})`,
      );
    }
  });
}
