// #644 W2 criterion 6 [D]: the consent pause reaches the key-value store only
// through `@vercel/kv`'s client, the one the rate limiter uses, so the guide's
// row for the store ("yes": the client honours the proxy variables) holds for
// it too, and nothing else in the app reaches the store.
//
// THE UNIVERSE is every tracked JavaScript or TypeScript file but tests
// (`git ls-files`), wherever it sits, as `model-call-registry.test.ts`
// derives its own. A file reaches the store when it imports `@vercel/kv` or
// the client under it, `@upstash/redis`. The answer must be exactly the
// limiter and `decision.ts`, and `decision.ts`'s store is that client's `kv`
// and nothing else.
//
// THE SCAN CAN FAIL. It is run first on a fixture tree that adds a third
// importer, and must name it.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/sources/decision-sole-store-client.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const STORE_CLIENT = /^\s*import\b[^;]*?\bfrom\s+['"](@vercel\/kv|@upstash\/redis)(\/[^'"]*)?['"]/m;

/** The files of `files` whose text imports a store client. */
function storeImporters(files: Array<{ file: string; text: string }>): string[] {
  return files.filter(({ text }) => STORE_CLIENT.test(text)).map(({ file }) => file).sort();
}

function trackedSources(): Array<{ file: string; text: string }> {
  const listed = execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' }).split('\n');
  return listed
    .filter((file) => /\.(c|m)?[jt]sx?$/.test(file) && !/\.test\.(c|m)?[jt]sx?$/.test(file))
    .map((file) => ({ file, text: readFileSync(path.join(REPO, file), 'utf8') }));
}

const EXPECTED = ['src/lib/rate-limit.ts', 'src/lib/sources/decision.ts'];

test('the scan names a third importer on a fixture tree', () => {
  const fixture = [
    { file: 'src/lib/rate-limit.ts', text: "import { kv } from '@vercel/kv';" },
    { file: 'src/lib/sources/decision.ts', text: "import { kv } from '@vercel/kv';" },
    { file: 'src/lib/elsewhere.ts', text: "import { Redis } from '@upstash/redis';" },
    { file: 'src/lib/prose.ts', text: '// the store is reached through @vercel/kv' },
  ];
  assert.deepEqual(storeImporters(fixture), ['src/lib/elsewhere.ts', 'src/lib/rate-limit.ts', 'src/lib/sources/decision.ts']);
});

test('criterion 6 [D]: only the rate limiter and decision.ts reach the store, both through @vercel/kv', () => {
  const tree = trackedSources();
  assert.ok(tree.length > 200, `only ${tree.length} files read: the universe is not being derived`);
  assert.deepEqual(storeImporters(tree), EXPECTED);
  for (const file of EXPECTED) {
    const text = tree.find((t) => t.file === file)!.text;
    assert.match(text, /^import \{ kv \} from '@vercel\/kv';$/m, `${file} does not import @vercel/kv's kv`);
  }
});

test('criterion 6 [D]: decision.ts\'s store is that client and no other', () => {
  const text = readFileSync(path.join(REPO, 'src/lib/sources/decision.ts'), 'utf8');
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.match(code, /KV_REST_API_URL && process\.env\.KV_REST_API_TOKEN \? kv : null/, 'the store is not kv on the limiter\'s pair, or null');
  assert.doesNotMatch(code, /new Map|createClient|new Redis/, 'decision.ts builds a store of its own');
});
