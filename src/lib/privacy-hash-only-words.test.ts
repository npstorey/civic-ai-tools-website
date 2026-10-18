// #516 P7 — the privacy page and the publish dialog say the same thing about a
// hash-only record, in the same words.
//
// WHAT IS DRIVEN. The real dialog (`src/components/PublishEvidenceDialog.tsx`),
// mounted through `src/components/publish-dialog-test-harness.ts` as its own
// test (`publish-dialog-hash-only.test.ts`) mounts it, and the real facts module
// (`src/lib/privacy-facts.ts`). The words the dialog renders beside its
// hash-only choice, and beside its title field, are read from the dialog's
// rendered tree; the page's are its constants, and the statement the page
// builds must carry them. Either side changing alone fails here.
//
// WHY THE DIALOG IS RENDERED RATHER THAN READ AS SOURCE. The words are JSX
// text split across source lines; a source read would compare the file's
// layout, and would keep passing if the dialog moved the words into a
// variable this test did not know about.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/privacy-hash-only-words.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as nodeModule from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

interface ResolveResult { url: string; format?: string | null; shortCircuit?: boolean }
interface LoadResult { format: string; source?: string; shortCircuit?: boolean }
type NextResolve = (specifier: string, context?: unknown) => ResolveResult;
type NextLoad = (url: string, context?: unknown) => LoadResult;
// Typed here because the installed `@types/node` predates `registerHooks`.
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: {
    resolve?: (specifier: string, context: unknown, nextResolve: NextResolve) => ResolveResult;
    load?: (url: string, context: unknown, nextLoad: NextLoad) => LoadResult;
  }): void;
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..');

// The resolver the dialog's own test registers before the harness's hooks.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const base = path.join(SRC, specifier.slice(2));
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
        try {
          if (fs.statSync(candidate).isFile()) return { url: pathToFileURL(candidate).href, shortCircuit: true };
        } catch { /* next candidate */ }
      }
      throw new Error(`#516 P7 hash-only words test hook: cannot resolve ${specifier}`);
    }
    const parent = (context as { parentURL?: string }).parentURL;
    if (specifier.startsWith('.') && !path.extname(specifier) && parent?.startsWith('file:')) {
      const base = path.resolve(path.dirname(fileURLToPath(parent)), specifier);
      for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
        if (fs.existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
  load(loadUrl, context, nextLoad) {
    if (loadUrl.startsWith('file:') && loadUrl.endsWith('.json')) {
      const json = fs.readFileSync(fileURLToPath(loadUrl), 'utf8');
      return { format: 'module', source: `export default ${json};`, shortCircuit: true };
    }
    return nextLoad(loadUrl, context);
  },
});

globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url === '/api/records/signing-status') return Response.json({ signingConfigured: true, sealOnly: false });
  throw new TypeError(`the dialog asked for ${url}, which this test does not answer`);
}) as typeof fetch;

const { mountPublishDialog, textOf } = await import(pathToFileURL(path.join(SRC, 'components', 'publish-dialog-test-harness.ts')).href);
const facts = await import('./privacy-facts.ts');

const PROPS = {
  queryText: 'A fixture question about noise reports',
  output: 'A fixture answer.',
  toolCalls: [],
  evidenceTrace: { resourceSpans: [] },
  model: 'fixture-fast',
  portal: 'data.example.org',
};

const dialog = await mountPublishDialog(PROPS);
await dialog.settle();

/** Collapse runs of whitespace: JSX text broken across lines renders single-spaced. */
const squash = (value: string) => value.replace(/\s+/g, ' ').trim();

function hashOnlyWords(): string {
  const label = dialog.elements().find((el: { type: unknown }) => el.type === 'label' && textOf(el).includes('Hash only'));
  assert.ok(label, 'the dialog has no hash-only choice');
  const text = squash(textOf(label));
  assert.ok(text.startsWith(facts.HASH_ONLY_CHOICE_LABEL), `the hash-only choice's label reads: ${text.slice(0, 40)}`);
  const words = text.slice(facts.HASH_ONLY_CHOICE_LABEL.length).trim();
  assert.ok(words.length > 0, 'the hash-only choice carries no words beside its label');
  return words;
}

test("the page's hash-only words are the dialog's, word for word", () => {
  assert.equal(facts.HASH_ONLY_RECORD_WORDS, hashOnlyWords());
});

test("the page's title words are the dialog's, word for word", () => {
  assert.ok(
    squash(dialog.text()).includes(facts.RECORD_TITLE_IS_PUBLIC),
    `the dialog does not say: ${facts.RECORD_TITLE_IS_PUBLIC}`,
  );
});

test('the page states both, with nothing configured', () => {
  const statements = facts.buildPrivacySections(null).flatMap((section: { statements: { id: string; parts: unknown[] }[] }) => section.statements);
  const said = (id: string) => statements.find((s) => s.id === id)?.parts.filter((p): p is string => typeof p === 'string').join('') ?? '';
  assert.ok(said('prompt-text').includes(facts.HASH_ONLY_RECORD_WORDS), `the page's hash-only statement reads: ${said('prompt-text')}`);
  assert.equal(said('record-title'), facts.RECORD_TITLE_IS_PUBLIC);
});
