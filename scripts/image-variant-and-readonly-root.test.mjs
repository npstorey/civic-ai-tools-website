// The runtime-image variant switch (#444) and the read-only root filesystem
// (#469), asserted where they are DECIDED rather than where they are observed.
//
// WHAT THIS FILE ANCHORS
//
//   #444  1. a global build argument selects the runtime base stage;
//         2. the switch switches — at its default the built target still
//            reaches the docker binary, so the reference image is unchanged
//            at its defaults, and some other value does not reach it;
//         3. at that other value the target needs no stage built FROM the
//            docker-CLI image, so that stage is outside the build graph and
//            is never built or pulled;
//         4. CI builds that off value, and the reference build still passes
//            no build argument at all.
//   #469  5. the app service runs with a read-only root filesystem;
//         6. it declares exactly one writable mount and `docs/deploy.md`
//            names that same path, so compose and the document cannot drift;
//         7. the `Dockerfile` creates that path for the runtime user, so the
//            document is describing this image and not a remembered one;
//         8. CI drives the built image read-only BOTH ways — with the mount
//            and without it — because a demonstration that only ever supplies
//            the mount is a criterion shaped so it cannot fail.
//
// HOW IT ASSERTS, AND WHY. The #444 assertions DISCOVER the switch rather
// than prescribing its spelling: the selector is found as "a global ARG whose
// default is the name of a stage this Dockerfile declares", the docker binary
// is found by reading COPY instructions, the CLI stage is found by what it is
// built FROM, and the build target is read out of the compose file. A rename
// of the argument, the stages or the target does not quietly turn these green.
//
// The stage graph is the subject, never a final filesystem. The census's
// warning is the reason: a variant that DELETES the binary in a later layer
// still ships it in a lower one, and `test ! -e` inside the finished image
// cannot tell the two apart. CI corroborates with a per-layer scan of the
// saved image and with that filesystem reading; this file asserts the graph.
//
// BLIND SPOTS, stated. This file reads text — the Dockerfile, the compose
// file, the deploy doc, the CI workflow. It builds no image, runs no
// container and executes no workflow. "CI drives it" here means "this
// workflow file contains a step that does", which is an assertion about the
// file and not about a runner; the run is the evidence and the phase record
// cites it. The compose reader is line-oriented rather than a YAML parser, so
// reformatting docker-compose.yml into flow style makes these tests fail
// rather than lie. And the readings of the workflow match command TEXT: a
// step that passed the same flags from a variable would be invisible to them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseDockerfile, stagesTheTargetNeeds } from './check-compose-env.mjs';

const DOCKER_BINARY = '/usr/local/bin/docker';

const repoFile = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const dockerfileText = repoFile('Dockerfile');
const composeText = repoFile('docker-compose.yml');
const deployDoc = repoFile('docs/deploy.md');
const ciWorkflow = repoFile('.github/workflows/ci.yml');

// --- reading the four files --------------------------------------------------

/** One top-level compose service's block, as raw text. */
function serviceBlock(text, service) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l === `  ${service}:`);
  assert.notEqual(start, -1, `docker-compose.yml declares no "${service}" service`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^ {2}\S/.test(l));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

const appBlock = serviceBlock(composeText, 'app');

/** The stage compose actually builds — the tests follow the real target. */
function composeTarget() {
  const m = /^\s*target:\s*(\S+)\s*$/m.exec(appBlock);
  assert.notEqual(m, null, 'the app service names no build target');
  return m[1];
}

/** Global ARGs (ahead of the first FROM) with their defaults, read from text. */
function globalArgDefaults(text) {
  const out = new Map();
  for (const line of text.split('\n')) {
    if (/^\s*FROM\s/i.test(line)) break;
    const m = /^\s*ARG\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (m) out.set(m[1], m[2].trim());
  }
  return out;
}

/** Stage index → does this stage COPY the docker binary in? */
function stagesCopyingDockerBinary(text) {
  const flagged = new Set();
  let stageIndex = -1;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (/^FROM\s/i.test(line)) {
      stageIndex += 1;
      continue;
    }
    if (/^COPY\s/i.test(line) && line.includes(DOCKER_BINARY)) flagged.add(stageIndex);
  }
  return flagged;
}

/** The stages the compose target needs, with `${name}` bound to `value`. */
function targetNeedsWith(name, value) {
  const substituted =
    name === null ? dockerfileText : dockerfileText.replaceAll(`\${${name}}`, value);
  return {
    substituted,
    needed: stagesTheTargetNeeds(parseDockerfile(substituted), composeTarget()),
  };
}

/** Does the target, built with `${name}` bound to `value`, reach the binary? */
function reachesDockerBinary(name, value) {
  const { substituted, needed } = targetNeedsWith(name, value);
  const copying = stagesCopyingDockerBinary(substituted);
  return needed.some((s) => copying.has(s.index));
}

const declaredStages = parseDockerfile(dockerfileText)
  .stages.map((s) => s.name)
  .filter((n) => n !== null);

/** The global ARG whose default names a stage — i.e. one that selects a stage. */
function stageSelectingArg() {
  for (const [name, value] of globalArgDefaults(dockerfileText)) {
    if (declaredStages.includes(value.toLowerCase())) return { name, value };
  }
  return null;
}

/** The selector, or a failed assertion naming what was looked for. */
function requireSelector() {
  const selector = stageSelectingArg();
  assert.notEqual(
    selector,
    null,
    'no global ARG defaults to the name of a stage this Dockerfile declares, so nothing selects ' +
      `the runtime base (global ARGs: ${[...globalArgDefaults(dockerfileText).keys()].join(', ')}; ` +
      `stages: ${declaredStages.join(', ')})`,
  );
  return selector;
}

/** Every value of the selector that produces a target without the binary. */
function valuesWithoutBinary(selector) {
  return declaredStages.filter(
    (stage) => stage !== selector.value && !reachesDockerBinary(selector.name, stage),
  );
}

/**
 * The global ARG naming a docker-CLI image, found by its VALUE. The stage that
 * pulls the CLI is then identified by what it is built FROM, never by name.
 */
function cliImageArg() {
  const found = [...globalArgDefaults(dockerfileText)].find(([, value]) =>
    /(^|\/)docker:/.test(value),
  );
  assert.notEqual(
    found,
    undefined,
    'no global ARG names a docker-CLI image, so these tests cannot find the stage that pulls one',
  );
  return found;
}

/** Stage indices that exist FOR the CLI: they copy the binary, or are built from its image. */
function cliStageIndices() {
  const [name, image] = cliImageArg();
  const references = [`\${${name}}`, image];
  const indices = new Set(stagesCopyingDockerBinary(dockerfileText));
  for (const stage of parseDockerfile(dockerfileText).stages) {
    if (references.includes(stage.from)) indices.add(stage.index);
  }
  return indices;
}

/** Does the target, at this value, still need a stage built FROM the CLI image? */
function needsCliStage(selector, value) {
  const [name, image] = cliImageArg();
  const references = [`\${${name}}`, image];
  return targetNeedsWith(selector.name, value).needed.some((s) => references.includes(s.from));
}

function neededIndices(selector, value) {
  return new Set(targetNeedsWith(selector.name, value).needed.map((s) => s.index));
}

/**
 * A genuine off value removes EXACTLY the CLI stages and nothing else.
 *
 * "Some value avoids the binary" is too weak to be worth asserting: pointing
 * the selector at `deps` also avoids it, and would also avoid the standalone
 * output, the sharp smoke test and the runtime user. So the property is a
 * difference, not an absence — at the off value the target needs a SUBSET of
 * what it needs at the default, and the stages that dropped out are precisely
 * the ones that exist to carry the docker CLI.
 */
function removesExactlyTheCliStages(selector, value) {
  const atDefault = neededIndices(selector, selector.value);
  const atValue = neededIndices(selector, value);
  if ([...atValue].some((i) => !atDefault.has(i))) return false;
  const removed = [...atDefault].filter((i) => !atValue.has(i)).sort((a, b) => a - b);
  const cli = [...cliStageIndices()].filter((i) => atDefault.has(i)).sort((a, b) => a - b);
  return removed.length > 0 && removed.join(',') === cli.join(',');
}

/** Values that turn the CLI off, and change nothing else about the graph. */
function offValues(selector) {
  return valuesWithoutBinary(selector).filter((v) => removesExactlyTheCliStages(selector, v));
}

/** The `container image build` job's body, as raw text. */
function containerImageJob() {
  const lines = ciWorkflow.split('\n');
  // Found by the job's `name:` — that is what the required check is called,
  // and the YAML key is not.
  const nameAt = lines.findIndex((l) => /^\s{4}name:\s*container image build\s*$/.test(l));
  assert.notEqual(
    nameAt,
    -1,
    '.github/workflows/ci.yml declares no job named "container image build"',
  );
  let jobAt = nameAt;
  while (jobAt >= 0 && !/^ {2}\S.*:\s*$/.test(lines[jobAt])) jobAt -= 1;
  const rest = lines.slice(jobAt + 1);
  const end = rest.findIndex((l) => /^ {2}\S/.test(l));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

const ciJob = containerImageJob();

/** Every `docker <verb> …` command line in that job, comments and wrapping out. */
function commandsInJob(verb) {
  return ciJob
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n')
    .replace(/\\\n\s*/g, ' ')
    .split('\n')
    .filter((l) => new RegExp(`\\bdocker ${verb}\\b`).test(l))
    .map((l) => l.trim());
}

/** The one writable path `docs/deploy.md` names. */
function documentedWritablePath() {
  const matches = [...deployDoc.matchAll(/^\s*-\s*\*\*Writable path:\*\*\s*`([^`]+)`/gm)];
  assert.equal(
    matches.length,
    1,
    matches.length === 0
      ? 'docs/deploy.md names no writable path (expected a line of the form ' +
          '"- **Writable path:** `/app/.next/cache`"), so the compose mount and the document ' +
          'cannot be checked against each other'
      : `docs/deploy.md names ${matches.length} writable paths (${matches
          .map((m) => m[1])
          .join(', ')}); the tests below compare the compose mounts against ONE. A second ` +
          'path is a finding to state — state it here too, and widen these assertions ' +
          'deliberately rather than by accident.',
  );
  return matches[0][1];
}

/** Every writable mount the app service declares, tmpfs in either syntax. */
function appWritableMounts() {
  const lines = appBlock.split('\n');
  const found = [];
  // Short syntax: a top-level `tmpfs:` list of paths.
  const tmpfsAt = lines.findIndex((l) => /^ {4}tmpfs:\s*$/.test(l));
  if (tmpfsAt !== -1) {
    for (const line of lines.slice(tmpfsAt + 1)) {
      if (/^\s*#/.test(line) || line.trim() === '') continue;
      const m = /^\s*-\s*(\S+)\s*$/.exec(line);
      if (!m) break;
      found.push(m[1].split(':')[0]);
    }
  }
  // Long syntax: `- type: tmpfs` with a `target:` under it, in `volumes:`.
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s*-\s*type:\s*tmpfs\s*$/.test(lines[i])) continue;
    const target = lines.slice(i + 1, i + 6).find((l) => /^\s*target:\s*\S+\s*$/.test(l));
    assert.notEqual(
      target,
      undefined,
      'a tmpfs mount on the app service declares no target: path',
    );
    found.push(/^\s*target:\s*(\S+)\s*$/.exec(target)[1]);
  }
  return found;
}

// --- #444: the switch, on the stage graph ------------------------------------

test('a global build argument selects the runtime base stage', () => {
  requireSelector();
});

test('the switch switches, and the default still carries the docker binary', () => {
  const selector = requireSelector();

  assert.equal(
    reachesDockerBinary(selector.name, selector.value),
    true,
    `at its default (${selector.value}) the built target must still reach ${DOCKER_BINARY} — ` +
      'the reference image is unchanged at the defaults',
  );

  const rejected = valuesWithoutBinary(selector).filter(
    (v) => !removesExactlyTheCliStages(selector, v),
  );
  assert.ok(
    offValues(selector).length > 0,
    `no value of ${selector.name} turns ${DOCKER_BINARY} off and leaves the rest of the build ` +
      `graph alone. Values that drop the binary by changing something else as well: ` +
      `${rejected.join(', ') || 'none'}. A switch that also drops the standalone output or the ` +
      'runtime user is not this switch.',
  );
});

test('at the off value the docker-CLI stage is outside the build graph', () => {
  const selector = requireSelector();
  const [, cliImage] = cliImageArg();

  // The control: at the default, the CLI stage must still be in the graph.
  // Without it the next assertion would pass on a Dockerfile that had simply
  // stopped using the CLI image at all.
  assert.ok(
    needsCliStage(selector, selector.value),
    `at the default (${selector.value}) the target must still need the stage built FROM ` +
      `${cliImage} — that stage is where the reference image's docker binary comes from`,
  );

  for (const off of offValues(selector)) {
    assert.equal(
      needsCliStage(selector, off),
      false,
      `${selector.name}=${off} drops the docker binary but still needs the stage built FROM ` +
        `${cliImage}; that stage would be built, and its image pulled, for nothing. Dropping ` +
        'the COPY is not enough — the unselected stage must stay outside the graph.',
    );
  }
});

test('CI builds the off variant, and the reference build passes no build argument', () => {
  const selector = requireSelector();
  const off = offValues(selector);

  const builds = commandsInJob('build');
  assert.ok(
    builds.length >= 2,
    `the "container image build" job runs ${builds.length} docker build command(s); it needs one ` +
      'for the reference image and one for the variant, or the variant rots untested',
  );

  const withArg = builds.filter((l) => l.includes('--build-arg'));
  const withoutArg = builds.filter((l) => !l.includes('--build-arg'));

  assert.ok(
    withoutArg.length >= 1,
    'no docker build in that job passes zero build arguments; "an operator\'s first build ' +
      'supplies no config" is part of what the job tests',
  );

  assert.ok(
    withArg.some((l) => off.some((value) => l.includes(`--build-arg ${selector.name}=${value}`))),
    `no docker build in that job passes ${selector.name} at a value that avoids ${DOCKER_BINARY} ` +
      `(values that would: ${off.join(', ') || 'none'}); commands seen: ` +
      `${withArg.join(' | ') || 'none'}`,
  );

  // The job's commentary says it passes no --build-arg. It now passes one, so
  // the commentary has to name the exception, or the next reader trusts a
  // sentence about credential-free building that is no longer true of the file.
  assert.match(
    ciJob,
    new RegExp(selector.name),
    `the "container image build" job passes --build-arg ${selector.name} but its commentary ` +
      'never names it; the "no --build-arg" note in that job must state the exception',
  );
});

// --- #469: the read-only root ------------------------------------------------

test('the app service runs with a read-only root filesystem', () => {
  assert.match(
    appBlock,
    /^\s*read_only:\s*true\s*$/m,
    'the app service does not set read_only: true, so nothing demonstrates that the runtime ' +
      'image needs exactly one writable path',
  );
});

test('the one writable path is mounted, and the deploy doc names the same path', () => {
  const documented = documentedWritablePath();
  const mounted = appWritableMounts();

  assert.deepEqual(
    mounted,
    [documented],
    `docs/deploy.md names "${documented}" as THE one writable path; the app service declares ` +
      `${mounted.join(', ') || 'no writable mount'}. #469 says a second writable path is stated, ` +
      'never silenced — so state it in the document too, and this assertion follows.',
  );
});

test('the Dockerfile creates the documented writable path for the runtime user', () => {
  const documented = documentedWritablePath();
  const inImage = documented.replace(/^\/app\//, '');
  assert.ok(
    dockerfileText.includes(inImage),
    `docs/deploy.md documents ${documented} as the image's one writable path, but the Dockerfile ` +
      `never mentions ${inImage}; the document is describing some other image`,
  );
  assert.match(
    dockerfileText,
    /^\s*USER\s+\S+\s*$/m,
    'the Dockerfile sets no USER, so "the mount must be writable by the runtime user" in ' +
      'docs/deploy.md has no runtime user to be about',
  );
});

test('the deploy doc says the rest of the filesystem may be read-only', () => {
  const documented = documentedWritablePath();
  const at = deployDoc.indexOf(`\`${documented}\``);
  const section = deployDoc.slice(Math.max(0, at - 1500), at + 1500);
  assert.match(
    section,
    /everything else/i,
    `docs/deploy.md names ${documented} but never says what the rest of the filesystem may be; ` +
      'the statement an operator needs is "this one path, and everything else read-only"',
  );
  assert.match(
    section,
    /read-only/i,
    'the writable-path section of docs/deploy.md never says "read-only"',
  );
});

test('CI drives the read-only root both ways, on the built image', () => {
  const documented = documentedWritablePath();
  const runs = commandsInJob('run').filter((l) => l.includes('--read-only'));

  assert.ok(
    runs.length >= 2,
    `the "container image build" job runs the image with --read-only ${runs.length} time(s); the ` +
      'statement is falsifiable only if the run WITHOUT the mount is driven too',
  );
  assert.ok(
    runs.some((l) => l.includes(`--tmpfs "${documented}`) || l.includes(`--tmpfs ${documented}`)),
    `no --read-only run in that job mounts ${documented}, the path docs/deploy.md documents ` +
      `(runs seen: ${runs.join(' | ')})`,
  );
  assert.ok(
    runs.some((l) => !l.includes('--tmpfs')),
    'every --read-only run in that job supplies the mount, so none of them can show what fails ' +
      'without it — that is a criterion shaped so it cannot fail',
  );
});
