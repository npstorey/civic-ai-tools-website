/**
 * Guard: the image's server keeps an idle connection longer than a load
 * balancer does.
 *
 * A load balancer reuses its connections to the app. When the app closes an
 * idle one first, a request the balancer sends on it at that moment is
 * answered 502 — AWS's documentation for application load balancers says to
 * configure the application's idle timeout larger than the balancer's, whose
 * default is 60 s. Node closes an idle connection after 5 s unless told
 * otherwise, and the standalone `server.js` that `next build` writes tells it
 * only through `KEEP_ALIVE_TIMEOUT`. So the image sets that variable, in the
 * runtime stage both image variants are built from.
 *
 * Two halves, because each can hold while the other does not:
 *   1. The Dockerfile sets `KEEP_ALIVE_TIMEOUT` in `runtime-without-docker-cli`
 *      (the base of both runtime variants), to a whole number of milliseconds
 *      above 60 000.
 *   2. The installed Next still honours it: the standalone server template
 *      reads `process.env.KEEP_ALIVE_TIMEOUT` and hands it to `startServer`,
 *      and `startServer` sets `server.keepAliveTimeout` from it. A Next upgrade
 *      that stopped reading it would leave half 1 green and the server back at
 *      5 s, so this half is read from `node_modules`, not assumed.
 *
 * Not here: Node's behaviour under that value, which takes a minute to show.
 * Measured 2026-09-25 on node:22-bookworm-slim (v22.23.2), the way
 * `startServer` builds its server: a keep-alive connection idle 65 s under
 * 620 000 answered its second request; with the variable unset it was closed
 * at about 6 s. `headersTimeout` (60 s) does not cut the idle connection.
 *
 * Run with: npm test (or: node --test scripts/keep-alive-timeout.test.mjs)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));

/** An application load balancer's default idle timeout, in milliseconds (AWS documentation). */
const ALB_DEFAULT_IDLE_MS = 60_000;

/** The instructions of one stage, from its FROM line to the next. */
function stage(dockerfile, name) {
  const lines = dockerfile.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^FROM\\s+\\S+\\s+AS\\s+${name}\\s*$`, 'i').test(l));
  assert.ok(start >= 0, `the Dockerfile has no stage named ${name}`);
  const end = lines.findIndex((l, i) => i > start && /^FROM\s/i.test(l));
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

/** Every `NAME=value` an ENV instruction in `text` sets, continuations joined. */
function envSettings(text) {
  const joined = text.replace(/\\\n/g, ' ');
  const settings = {};
  for (const line of joined.split('\n')) {
    const m = /^ENV\s+(.*)$/i.exec(line.trim());
    if (!m) continue;
    for (const pair of m[1].trim().split(/\s+/)) {
      const eq = pair.indexOf('=');
      if (eq > 0) settings[pair.slice(0, eq)] = pair.slice(eq + 1);
    }
  }
  return settings;
}

test('the runtime base both image variants share sets KEEP_ALIVE_TIMEOUT above the load balancer default', () => {
  const dockerfile = readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  const base = envSettings(stage(dockerfile, 'runtime-without-docker-cli'));
  assert.ok('KEEP_ALIVE_TIMEOUT' in base, 'runtime-without-docker-cli sets no KEEP_ALIVE_TIMEOUT: the server keeps Node\'s 5 s');
  assert.match(base.KEEP_ALIVE_TIMEOUT, /^\d+$/, 'KEEP_ALIVE_TIMEOUT is not a whole number of milliseconds');
  assert.ok(Number(base.KEEP_ALIVE_TIMEOUT) > ALB_DEFAULT_IDLE_MS, `KEEP_ALIVE_TIMEOUT=${base.KEEP_ALIVE_TIMEOUT} does not exceed ${ALB_DEFAULT_IDLE_MS} ms`);

  // Both variants inherit it: the docker-CLI variant is built FROM this stage,
  // and nothing later overrides the value.
  assert.match(stage(dockerfile, 'runtime-with-docker-cli'), /^FROM\s+runtime-without-docker-cli\s+AS/im);
  for (const name of ['runtime-with-docker-cli', 'runner']) {
    assert.ok(!('KEEP_ALIVE_TIMEOUT' in envSettings(stage(dockerfile, name))), `${name} overrides KEEP_ALIVE_TIMEOUT`);
  }
});

test('the installed Next standalone server reads KEEP_ALIVE_TIMEOUT and applies it to the server', () => {
  const nextDir = path.dirname(require.resolve('next/package.json'));
  const template = readFileSync(path.join(nextDir, 'dist/build/utils.js'), 'utf8');
  assert.match(template, /parseInt\(process\.env\.KEEP_ALIVE_TIMEOUT, 10\)/, 'the standalone server template no longer reads KEEP_ALIVE_TIMEOUT');
  assert.match(template, /startServer\(\{[\s\S]*?keepAliveTimeout,[\s\S]*?\}\)/, 'the standalone server template no longer passes keepAliveTimeout to startServer');
  const startServer = readFileSync(path.join(nextDir, 'dist/server/lib/start-server.js'), 'utf8');
  assert.match(startServer, /server\.keepAliveTimeout = keepAliveTimeout/, 'startServer no longer applies keepAliveTimeout to the server');
});
