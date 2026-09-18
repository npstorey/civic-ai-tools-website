// RED INSTRUMENT for Wave N12 phase W2 (#444 + #469), anchor #470.
//
// Four assertions, all failing at `d9187cf`:
//
//   #444  1. a global build argument selects the runtime base stage;
//         2. the switch actually switches — one value reaches the stage that
//            copies the docker binary, another does not, and the DEFAULT still
//            does, so the reference image is unchanged at its defaults;
//   #469  3. the app service runs with a read-only root filesystem;
//         4. it mounts a writable path, and `docs/deploy.md` names that same
//            path, so the compose file and the document cannot drift.
//
// The #444 assertions are written as PROPERTIES and discover the switch rather
// than prescribing its spelling: the selector is found as "a global ARG whose
// default is the name of a stage this file declares", and the docker binary is
// found by reading the COPY instructions rather than by trusting a stage name.
// The census's warning is the reason: a variant that deletes the binary in a
// later layer still ships it in a lower one, so the assertion is on the stage
// graph, not on a final filesystem.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseDockerfile, stagesTheTargetNeeds } from './check-compose-env.mjs';

const DOCKER_BINARY = '/usr/local/bin/docker';

const repoFile = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const dockerfileText = repoFile('Dockerfile');
const composeText = repoFile('docker-compose.yml');
const deployDoc = repoFile('docs/deploy.md');

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

/** The stage compose actually builds — the test follows the real target. */
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
    if (/^FROM\s/i.test(line)) { stageIndex += 1; continue; }
    if (/^COPY\s/i.test(line) && line.includes(DOCKER_BINARY)) flagged.add(stageIndex);
  }
  return flagged;
}

/** Does the target, built with `${name}` bound to `value`, reach the binary? */
function reachesDockerBinary(name, value) {
  const substituted = name === null
    ? dockerfileText
    : dockerfileText.replaceAll(`\${${name}}`, value);
  const parsed = parseDockerfile(substituted);
  const copying = stagesCopyingDockerBinary(substituted);
  return stagesTheTargetNeeds(parsed, composeTarget()).some((s) => copying.has(s.index));
}

const declaredStages = parseDockerfile(dockerfileText).stages
  .map((s) => s.name)
  .filter((n) => n !== null);

/** The global ARG whose default names a stage — i.e. one that selects a stage. */
function stageSelectingArg() {
  for (const [name, value] of globalArgDefaults(dockerfileText)) {
    if (declaredStages.includes(value.toLowerCase())) return { name, value };
  }
  return null;
}

test('a global build argument selects the runtime base stage', () => {
  const selector = stageSelectingArg();
  assert.notEqual(
    selector,
    null,
    'no global ARG defaults to the name of a stage this Dockerfile declares, so nothing selects ' +
      `the runtime base (global ARGs: ${[...globalArgDefaults(dockerfileText).keys()].join(', ')}; ` +
      `stages: ${declaredStages.join(', ')})`,
  );
});

test('the switch switches, and the default still carries the docker binary', () => {
  const selector = stageSelectingArg();
  assert.notEqual(selector, null, 'no stage-selecting global ARG to drive');

  assert.equal(
    reachesDockerBinary(selector.name, selector.value),
    true,
    `at its default (${selector.value}) the built target must still reach ${DOCKER_BINARY} — ` +
      'the reference image is unchanged at the defaults',
  );

  const outcomes = declaredStages.map((stage) => reachesDockerBinary(selector.name, stage));
  assert.ok(
    outcomes.includes(false),
    `no value of ${selector.name} produces a target that avoids ${DOCKER_BINARY}; the switch ` +
      'does not switch',
  );
});

test('the app service runs with a read-only root filesystem', () => {
  assert.match(
    appBlock,
    /^\s*read_only:\s*true\s*$/m,
    'the app service does not set read_only: true, so nothing demonstrates that the runtime image ' +
      'needs exactly one writable path',
  );
});

test('the one writable path is mounted, and the deploy doc names the same path', () => {
  const mounted = [...appBlock.matchAll(/^\s*-?\s*(?:target:\s*)?(\/app\/\S+|\.next\/\S+)\s*$/gm)]
    .map((m) => m[1]);
  const tmpfs = /^\s*tmpfs:\s*$/m.test(appBlock) || /^\s*type:\s*tmpfs\s*$/m.test(appBlock);
  assert.ok(
    tmpfs && mounted.length > 0,
    `the app service mounts no writable path (tmpfs declared: ${tmpfs}, paths seen: ` +
      `${mounted.join(', ') || 'none'}) — the read-only root has nowhere to write its cache`,
  );

  const documented = /^\s*-\s*\*\*Writable path:\*\*\s*`([^`]+)`/m.exec(deployDoc);
  assert.notEqual(
    documented,
    null,
    'docs/deploy.md names no writable path, so the compose mount and the document cannot be ' +
      'checked against each other',
  );
  assert.ok(
    mounted.some((p) => p.endsWith(documented[1]) || documented[1].endsWith(p)),
    `docs/deploy.md names "${documented[1]}" but the app service mounts ${mounted.join(', ')}`,
  );
});
