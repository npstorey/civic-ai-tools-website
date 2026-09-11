// THROWAWAY — Wave N11 (#434) P1 red instrument. Not for merge; the PR carrying it is closed unmerged.
//
// Derives every environment variable name the deployed app reads and asserts each one is declared in
// scripts/preflight-env.mjs ENV_SPEC (as `name` or `priorEraName`) or allowlisted by reason. At ea1164c
// it must fail naming exactly the four names the census found in neither ENV_SPEC nor compose.
//
// Universe: `git ls-files`, every tracked JS/TS source that is not a test, minus `scripts/` (operator
// tooling run by hand, not the deployed app). No directory list beyond that one stated exclusion.
// Read forms: `process.env.NAME`, `process.env['NAME']`, `env.NAME` through an env record handed in as
// a parameter, and a bracket read through a same-file string constant. Comments are stripped first,
// so prose naming a variable is not a read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ENV_SPEC } from './preflight-env.mjs';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const SOURCE = /\.(c|m)?[jt]sx?$/;
const TEST = /\.test\.(c|m)?[jt]sx?$/;
const EXCLUDED_PREFIXES = ['scripts/'];
const ALLOW = {
  NODE_ENV: 'set by the Node/Next runtime, never by an operator',
  BUILD_STANDALONE: 'set by `npm run build:standalone` itself (package.json), never by an operator',
};

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1');
}

function namesRead(src) {
  const code = stripComments(src);
  const names = new Set();
  for (const m of code.matchAll(/\bprocess\.env\.([A-Z][A-Z0-9_]*)/g)) names.add(m[1]);
  for (const m of code.matchAll(/\bprocess\.env\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g)) names.add(m[1]);
  for (const m of code.matchAll(/\benv\??\.([A-Z][A-Z0-9_]{2,})\b/g)) names.add(m[1]);
  const consts = new Map(
    [...code.matchAll(/\bconst\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*['"]([A-Z][A-Z0-9_]*)['"]/g)].map((m) => [m[1], m[2]]),
  );
  for (const m of code.matchAll(/\b(?:process\.env|env)\[\s*([A-Za-z_][A-Za-z0-9_]*)\s*\]/g)) {
    if (consts.has(m[1])) names.add(consts.get(m[1]));
  }
  return names;
}

function scan() {
  const files = execFileSync('git', ['ls-files', '-z', '--full-name'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter((p) => p && SOURCE.test(p) && !TEST.test(p) && !EXCLUDED_PREFIXES.some((x) => p.startsWith(x)));
  const readers = new Map();
  for (const f of files) {
    for (const n of namesRead(readFileSync(path.join(root, f), 'utf8'))) {
      if (!readers.has(n)) readers.set(n, []);
      readers.get(n).push(f);
    }
  }
  return { files, readers };
}

test('the scan measures: it sees a read in each form it claims', () => {
  const { files, readers } = scan();
  assert.ok(files.length > 100, `git ls-files yielded ${files.length} source files — the scan has stopped measuring`);
  for (const [name, form] of [
    ['SITE_DEFAULT_PORTAL', 'process.env.NAME'],
    ['APP_HOST', 'env.NAME through a parameter'],
    ['SIGN_IN_ALLOWLIST', 'a bracket read through a string constant'],
    ['DATABASE_URL', 'a root config file outside src/'],
  ]) {
    assert.ok(readers.has(name), `the scan did not see ${name} (${form}) — the extractor is blind to that form`);
  }
});

test('every environment variable the deployed app reads is declared in ENV_SPEC or allowlisted by reason', () => {
  const declared = new Set(ENV_SPEC.flatMap((e) => [e.name, e.priorEraName].filter(Boolean)));
  const { readers } = scan();
  const undeclared = [...readers]
    .filter(([n]) => !declared.has(n) && !(n in ALLOW))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([n, fs]) => `${n} (${fs.join(', ')})`);
  assert.deepEqual(undeclared, [], `read by the app but declared in neither ENV_SPEC nor the allowlist:\n  ${undeclared.join('\n  ')}`);
});
