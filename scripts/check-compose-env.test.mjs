// Unit tests for the compose environment-coverage guard.
//
// Run with:  node --test scripts/check-compose-env.test.mjs
// (`npm test` globs scripts/**/*.test.mjs, so this runs there and in CI.)
//
// The last test in this file is the gate: it runs the check against the real
// docker-compose.yml. Everything above it pins the behavior that makes that
// gate meaningful.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_SERVICE,
  checkComposeEnvCoverage,
  checkRepository,
  commandBuildsTheApp,
  parseComposeService,
  parseDockerfile,
  renderComposeReport,
} from './check-compose-env.mjs';
import { ENV_SPEC } from './preflight-env.mjs';

/** A compose file in the shape this repo uses, small enough to reason about. */
function fixture({ env = [], args = null, envFile = null } = {}) {
  const lines = ['services:', '  postgres:', '    image: postgres:17-bookworm', '  app:', '    build:', '      context: .', '      target: runner'];
  if (args) {
    lines.push('      args:');
    for (const a of args) lines.push(`        ${a}`);
  }
  if (envFile) {
    lines.push('    env_file:');
    lines.push(`      - ${envFile}`);
  }
  lines.push('    environment:');
  lines.push('      # a comment inside the block');
  for (const e of env) lines.push(`      ${e}`);
  return lines.join('\n') + '\n';
}

/** A tiny spec, so a test is not hostage to the real inventory's contents. */
const SPEC = [
  { name: 'RUNTIME_ONE', tier: 'required', purpose: 'runtime' },
  { name: 'RUNTIME_TWO', tier: 'optional', purpose: 'runtime' },
  { name: 'BOTH_ONE', readBy: 'build-and-runtime', tier: 'optional', purpose: 'both' },
  { name: 'BUILD_ONE', readBy: 'build', tier: 'optional', purpose: 'build' },
  { name: 'TOOL_ONE', readBy: 'external-tool', tier: 'optional', purpose: 'a script reads it' },
];

const COMPLETE = fixture({
  env: ['RUNTIME_ONE:', 'RUNTIME_TWO:', 'BOTH_ONE:'],
  args: ['BOTH_ONE:', 'BUILD_ONE:'],
});

// --- parsing ---------------------------------------------------------------

test('bare NAME parses as null (pass-through) and NAME: value as its value', () => {
  const { environment } = parseComposeService(
    fixture({ env: ['BARE:', 'LITERAL: container', 'INTERP: ${X:-y}'] }),
  );
  assert.equal(environment.get('BARE'), null);
  assert.equal(environment.get('LITERAL'), 'container');
  assert.equal(environment.get('INTERP'), '${X:-y}');
});

test('build.args and env_file are read; comments and other services are ignored', () => {
  const parsed = parseComposeService(fixture({ env: ['A:'], args: ['B:'], envFile: 'ops.env' }));
  assert.deepEqual([...parsed.environment.keys()], ['A']);
  assert.deepEqual([...parsed.buildArgs.keys()], ['B']);
  assert.deepEqual(parsed.envFiles, ['ops.env']);
  assert.deepEqual(parsed.build, { context: '.', target: 'runner' }, 'the build scalars that locate the Dockerfile stage');
});

test('sequence-form environment throws rather than silently reading nothing', () => {
  const text = 'services:\n  app:\n    environment:\n      - FOO=bar\n';
  assert.throws(() => parseComposeService(text), /sequence-form/);
});

test('a missing app service throws rather than passing vacuously', () => {
  assert.throws(() => parseComposeService('services:\n  postgres:\n    image: postgres\n'), /no `app` service/);
});

// --- coverage --------------------------------------------------------------

test('a complete compose file passes', () => {
  const r = checkComposeEnvCoverage(COMPLETE, SPEC);
  assert.equal(r.ok, true);
  assert.deepEqual(r.missingRuntime, []);
  assert.deepEqual(r.missingBuildArg, []);
});

test('THE DEFECT: a variable the app reads but compose omits fails, by name', () => {
  const r = checkComposeEnvCoverage(fixture({ env: ['RUNTIME_ONE:'], args: ['BOTH_ONE:', 'BUILD_ONE:'] }), SPEC);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missingRuntime.map((e) => e.name), ['RUNTIME_TWO', 'BOTH_ONE']);
  assert.match(renderComposeReport(r), /RUNTIME_TWO/);
});

test('a build-time variable missing from build.args fails even when the environment lists it', () => {
  const r = checkComposeEnvCoverage(fixture({ env: ['RUNTIME_ONE:', 'RUNTIME_TWO:', 'BOTH_ONE:'], args: ['BUILD_ONE:'] }), SPEC);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missingBuildArg.map((e) => e.name), ['BOTH_ONE']);
});

test('a build-only variable listed under environment is flagged as inert there', () => {
  const r = checkComposeEnvCoverage(
    fixture({ env: ['RUNTIME_ONE:', 'RUNTIME_TWO:', 'BOTH_ONE:', 'BUILD_ONE:'], args: ['BOTH_ONE:', 'BUILD_ONE:'] }),
    SPEC,
  );
  assert.equal(r.ok, false);
  assert.deepEqual(r.runtimeInert.map((e) => e.name), ['BUILD_ONE']);
});

test('an external-tool variable is never demanded of the container', () => {
  const r = checkComposeEnvCoverage(COMPLETE, SPEC);
  assert.equal(r.missingRuntime.some((e) => e.name === 'TOOL_ONE'), false);
  assert.equal(r.missingBuildArg.some((e) => e.name === 'TOOL_ONE'), false);
});

test('a variable compose passes that the spec does not declare is reported as drift', () => {
  const r = checkComposeEnvCoverage(
    fixture({ env: ['RUNTIME_ONE:', 'RUNTIME_TWO:', 'BOTH_ONE:', 'GHOST:'], args: ['BOTH_ONE:', 'BUILD_ONE:'] }),
    SPEC,
  );
  assert.equal(r.ok, false);
  assert.deepEqual(r.undeclared, ['GHOST']);
});

// --- the empty-string-vs-unset rule ---------------------------------------

test('EMPTY VS UNSET: ${NAME:-} is rejected — it sets "" where unset was meant', () => {
  const r = checkComposeEnvCoverage(
    fixture({ env: ['RUNTIME_ONE:', 'RUNTIME_TWO: ${RUNTIME_TWO:-}', 'BOTH_ONE:'], args: ['BOTH_ONE:', 'BUILD_ONE:'] }),
    SPEC,
  );
  assert.equal(r.ok, false);
  assert.deepEqual(r.emptyDefaultForm, ['RUNTIME_TWO']);
  assert.match(renderComposeReport(r), /Empty is not absent/);
});

test('bare ${NAME} is rejected too (compose blanks it when unset)', () => {
  const r = checkComposeEnvCoverage(
    fixture({ env: ['RUNTIME_ONE: ${RUNTIME_ONE}', 'RUNTIME_TWO:', 'BOTH_ONE:'], args: ['BOTH_ONE:', 'BUILD_ONE:'] }),
    SPEC,
  );
  assert.deepEqual(r.emptyDefaultForm, ['RUNTIME_ONE']);
});

test('a real default ${NAME:-value} is fine — it is a choice, not an accident', () => {
  const r = checkComposeEnvCoverage(
    fixture({ env: ['RUNTIME_ONE: ${RUNTIME_ONE:-hello}', 'RUNTIME_TWO:', 'BOTH_ONE:'], args: ['BOTH_ONE:', 'BUILD_ONE:'] }),
    SPEC,
  );
  assert.equal(r.ok, true);
});

// --- profile awareness -----------------------------------------------------

test('the compose file pins the profile; variables it will never read are not demanded', () => {
  // BLOB_READ_WRITE_TOKEN is onlyWhen blob=vercel-blob, so a file that pins
  // BLOB_DRIVER: s3 must not be told to pass it.
  const text = fixture({ env: ['BLOB_DRIVER: s3', 'EXECUTOR_DRIVER: container'] });
  const r = checkComposeEnvCoverage(text, ENV_SPEC);
  assert.equal(r.drivers.blob, 's3');
  assert.equal(r.drivers.executor, 'container');
  const demanded = r.missingRuntime.map((e) => e.name);
  assert.equal(demanded.includes('BLOB_READ_WRITE_TOKEN'), false);
  assert.equal(demanded.includes('SANDBOX_SNAPSHOT_ID'), false);
  // …and it IS told about the ones that profile reads.
  assert.equal(demanded.includes('S3_BUCKET'), true);
});

test('env_file makes run-time coverage unprovable, and the report says so', () => {
  const r = checkComposeEnvCoverage(fixture({ env: ['RUNTIME_ONE:'], args: ['BOTH_ONE:', 'BUILD_ONE:'], envFile: 'ops.env' }), SPEC);
  assert.equal(r.coverageProvable, false);
  assert.deepEqual(r.missingRuntime, []);
  assert.match(renderComposeReport(r), /coverage cannot be proven statically/);
});

// --- the image build (check 4, #434) -----------------------------------------

/** A Dockerfile in the shape this repo's takes: the build runs in `builder`,
 *  and the `runner` target reaches it only through `COPY --from`. */
function dockerfile({ builderArgs = ['BOTH_ONE', 'BUILD_ONE'], runnerArgs = [], globalArgs = [], argsAfterBuild = [], runnerCopiesBuilder = true } = {}) {
  return [
    '# syntax=docker/dockerfile:1',
    'ARG NODE_IMAGE=node:22-bookworm-slim',
    ...globalArgs.map((a) => `ARG ${a}`),
    'FROM ${NODE_IMAGE} AS deps',
    'RUN npm ci',
    'FROM ${NODE_IMAGE} AS builder',
    ...builderArgs.map((a) => `ARG ${a}`),
    'COPY --from=deps /app/node_modules ./node_modules',
    'RUN npm run build:standalone \\',
    '  && echo built',
    ...argsAfterBuild.map((a) => `ARG ${a}`),
    'FROM builder AS migrate',
    'CMD ["npx", "drizzle-kit", "migrate"]',
    'FROM ${NODE_IMAGE} AS runner',
    ...runnerArgs.map((a) => `ARG ${a}`),
    ...(runnerCopiesBuilder ? ['COPY --from=builder /app/.next/standalone ./'] : []),
    'RUN node -e "console.log(1)"',
    'CMD ["node", "server.js"]',
  ].join('\n');
}

const PACKAGE_JSON = JSON.stringify({
  scripts: {
    'build:standalone': 'BUILD_STANDALONE=1 next build && npm run check:standalone',
    'check:standalone': 'node scripts/check-standalone-assets.mjs',
  },
});

/** The `image` option: the two files check 4 reads from the build context. */
function image(dockerfileText) {
  return {
    readFile: (path) => {
      if (path === 'Dockerfile') return dockerfileText;
      if (path === 'package.json') return PACKAGE_JSON;
      throw new Error(`the check read an unexpected path: ${path}`);
    },
  };
}

test('parseDockerfile: stages, per-stage and global ARGs, joined continuations, the stages each needs', () => {
  const parsed = parseDockerfile(dockerfile({ globalArgs: ['G'] }));
  assert.deepEqual(parsed.globalArgs.map((a) => a.name), ['NODE_IMAGE', 'G']);
  assert.deepEqual(parsed.stages.map((s) => s.name), ['deps', 'builder', 'migrate', 'runner']);
  const builder = parsed.stages[1];
  assert.deepEqual(builder.args.map((a) => a.name), ['BOTH_ONE', 'BUILD_ONE']);
  assert.deepEqual(builder.needs, ['deps']);
  assert.equal(builder.runs[0].command, 'npm run build:standalone && echo built', 'a continuation is one RUN');
  assert.equal(parsed.stages[2].from, 'builder');
  assert.equal(parsed.stages[3].commands[0].command, 'node server.js', 'exec-form CMD is read as its words');
});

test('parseDockerfile: a heredoc, or an instruction ahead of the first FROM, throws rather than mis-reading', () => {
  assert.throws(() => parseDockerfile('FROM node AS a\nRUN <<EOF\necho hi\nEOF\n'), /heredoc/);
  assert.throws(() => parseDockerfile('ENV A=1\nFROM node\n'), /ahead of the first FROM/);
  assert.throws(() => parseDockerfile('# comment only\n'), /no FROM/);
});

test('a RUN builds the app only if its command reaches next build — itself, or through package.json', () => {
  const scripts = JSON.parse(PACKAGE_JSON).scripts;
  assert.equal(commandBuildsTheApp('npm run build:standalone', scripts), true);
  assert.equal(commandBuildsTheApp('npx next build', {}), true);
  assert.equal(commandBuildsTheApp('npm ci', scripts), false);
  assert.equal(commandBuildsTheApp('npm run check:standalone', scripts), false);
  assert.equal(commandBuildsTheApp('npm run build', { prebuild: 'next build', build: 'echo done' }), true, 'npm runs the pre hook too');
});

test('the image build passes when the stage that runs the build declares every build-time variable', () => {
  const r = checkComposeEnvCoverage(COMPLETE, SPEC, APP_SERVICE, image(dockerfile()));
  assert.equal(r.imageBuild.checked, true);
  assert.equal(r.imageBuild.error, null);
  assert.deepEqual(r.imageBuild.buildRuns, [{ stage: 'builder', line: 9 }], 'derived: the target needs builder, and builder runs next build');
  assert.deepEqual(r.imageBuild.missingArg, []);
  assert.equal(r.ok, true);
  assert.match(renderComposeReport(r), /IMAGE: target "runner" — next build runs in stage "builder" \(Dockerfile:9\)/);
});

test('THE IMAGE-BUILD DEFECT: a build arg with no ARG in the stage that runs the build fails, by name', () => {
  const r = checkComposeEnvCoverage(COMPLETE, SPEC, APP_SERVICE, image(dockerfile({ builderArgs: ['BUILD_ONE'] })));
  assert.equal(r.ok, false);
  assert.deepEqual(r.imageBuild.missingArg, [
    { name: 'BOTH_ONE', sources: ['compose build.args', 'ENV_SPEC readBy: build-and-runtime'] },
  ]);
  assert.match(renderComposeReport(r), /have no ARG in the stage that runs the build[\s\S]*- BOTH_ONE/);
});

test('the stage is derived: an ARG in the target stage, ahead of the first FROM, or after the build does not count', () => {
  for (const [label, shape] of [
    ['in the runner target', { builderArgs: ['BUILD_ONE'], runnerArgs: ['BOTH_ONE'] }],
    ['ahead of the first FROM', { builderArgs: ['BUILD_ONE'], globalArgs: ['BOTH_ONE'] }],
    ['after the RUN that builds', { builderArgs: ['BUILD_ONE'], argsAfterBuild: ['BOTH_ONE'] }],
  ]) {
    const r = checkComposeEnvCoverage(COMPLETE, SPEC, APP_SERVICE, image(dockerfile(shape)));
    assert.deepEqual(r.imageBuild.missingArg.map((m) => m.name), ['BOTH_ONE'], `an ARG ${label} reached no build`);
  }
});

test('an ENV_SPEC build-time variable is checked against the Dockerfile even when compose omits it', () => {
  const r = checkComposeEnvCoverage(
    fixture({ env: ['RUNTIME_ONE:', 'RUNTIME_TWO:', 'BOTH_ONE:'], args: ['BOTH_ONE:'] }),
    SPEC,
    APP_SERVICE,
    image(dockerfile({ builderArgs: ['BOTH_ONE'] })),
  );
  assert.deepEqual(r.missingBuildArg.map((e) => e.name), ['BUILD_ONE']);
  assert.deepEqual(r.imageBuild.missingArg, [{ name: 'BUILD_ONE', sources: ['ENV_SPEC readBy: build'] }]);
});

test('no RUN that builds in the stages the target needs fails closed, and so does an unknown target', () => {
  const unreachable = checkComposeEnvCoverage(COMPLETE, SPEC, APP_SERVICE, image(dockerfile({ runnerCopiesBuilder: false })));
  assert.equal(unreachable.ok, false);
  assert.match(unreachable.imageBuild.error, /no RUN in the stages target "runner" needs reaches `next build`/);
  assert.match(renderComposeReport(unreachable), /the image build cannot be checked/);

  const unknown = checkComposeEnvCoverage(COMPLETE.replace('target: runner', 'target: nowhere'), SPEC, APP_SERVICE, image(dockerfile()));
  assert.equal(unknown.ok, false);
  assert.match(unknown.imageBuild.error, /target "nowhere", which the Dockerfile does not declare/);
});

test('without the image option the image build is reported unchecked, not passed', () => {
  const r = checkComposeEnvCoverage(COMPLETE, SPEC);
  assert.deepEqual(r.imageBuild, { checked: false });
});

// --- the gate --------------------------------------------------------------

test("GATE: the repo's docker-compose.yml and Dockerfile can deliver every variable the app reads", () => {
  const result = checkRepository();
  assert.equal(result.imageBuild.checked, true, 'the gate did not read the Dockerfile — check 4 did not run');
  assert.deepEqual(
    result.imageBuild.buildRuns.map((r) => r.stage),
    ['builder'],
    'the derivation no longer finds the RUN that builds in the builder stage — re-read the Dockerfile before trusting a pass',
  );
  assert.equal(result.ok, true, renderComposeReport(result, APP_SERVICE));
});
