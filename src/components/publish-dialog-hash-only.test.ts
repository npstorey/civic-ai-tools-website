// #516 P10 — under hash-only visibility, a record carries no verbatim copy of
// the question: what the publish dialog defaults, sends and says.
//
// WHAT IS DRIVEN. The real dialog (`PublishEvidenceDialog.tsx`), mounted,
// clicked and typed into through `publish-dialog-test-harness.ts`, and its
// markup rendered by the real `react-dom/server`. Its requests are answered
// here: `signing-status` at once, and `generate-summary` when a test says so,
// so the order in which two replies arrive is the test's to choose.
//
// WHAT IS ASSERTED.
//   5. The title. Under hash-only visibility the default title is neutral,
//      built from the run (its portal and the date). Switching the visibility
//      updates a default the reader has not edited; a title the reader typed is
//      kept as typed. The field says the title is public and becomes the
//      record's address. Under full-text visibility the default is the
//      question, as before.
//   6. The words and the summary request. The hash-only choice says what the
//      record keeps instead of the question and what may still carry its
//      words. A summary request made while hash-only visibility is selected
//      carries no form of the question, and the summary standing under it is
//      the one that request returned, whichever reply arrives last. The
//      generated summary itself is model text and is not filtered.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/components/publish-dialog-hash-only.test.ts)

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

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const base = path.join(SRC, specifier.slice(2));
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
        try {
          if (fs.statSync(candidate).isFile()) return { url: pathToFileURL(candidate).href, shortCircuit: true };
        } catch { /* next candidate */ }
      }
      throw new Error(`#516 P10 render test hook: cannot resolve ${specifier}`);
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

const { mountPublishDialog, fire, textOf } = await import('./publish-dialog-test-harness.ts');
type Mounted = Awaited<ReturnType<typeof mountPublishDialog>>;

const PORTAL = 'data.example.org';
const QUESTION = 'Which "quiet hours" blocks near Fort Greene logged noise reports & why?';
const LONG_QUESTION = `${QUESTION} And how did the counts change between the first and the second half of the year?`;
const ANSWER = 'Nine reports were recorded across three blocks.\n\nOne request returned the figure.';
const SUMMARY_WITH_QUESTION_REQUEST = 'Model summary drafted from a request that carried the question.';
const SUMMARY_WITHOUT_QUESTION_REQUEST = 'Model summary drafted from a request that carried no question.';
const HASH_ONLY_WORDS =
  'The record keeps a fingerprint of your question instead of its text. Anyone who knows or guesses the exact ' +
  'wording can confirm it matches. The answer, summary and data queries may still contain its words.';
const TITLE_NOTE = 'The title is public and becomes the record’s address.';

const FORMS = [QUESTION, encodeURIComponent(QUESTION), JSON.stringify(QUESTION).slice(1, -1)];
const carriesQuestion = (value: unknown) => FORMS.some((form) => JSON.stringify(value ?? null).includes(JSON.stringify(form).slice(1, -1)));

// --- The dialog's requests, answered here ---------------------------------------

interface Pending { body: Record<string, unknown>; reply: (summary: string) => void }
let SUMMARY_REQUESTS: Pending[] = [];
let PUBLISH_BODIES: Array<Record<string, unknown>> = [];

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
  if (url === '/api/records/signing-status') return Response.json({ signingConfigured: true, sealOnly: false });
  if (url === '/api/records/generate-summary') {
    return new Promise<Response>((resolve) => {
      SUMMARY_REQUESTS.push({ body, reply: (summary) => resolve(Response.json({ summary })) });
    });
  }
  if (url === '/api/records') {
    PUBLISH_BODIES.push(body);
    return Response.json({ slug: 'fixture-abc123', visibility: 'sealed', packageHash: 'f'.repeat(64) });
  }
  throw new TypeError(`the dialog asked for ${url}, which this test does not answer`);
}) as typeof fetch;

const PROPS = {
  queryText: QUESTION,
  output: ANSWER,
  toolCalls: [{ name: 'socrata__get_data', args: { portal: PORTAL, dataset_id: 'erm2-nwe9', query: 'SELECT count(*)' } }],
  evidenceTrace: { resourceSpans: [] },
  model: 'fixture-fast',
  portal: PORTAL,
};

async function open(props: Record<string, unknown> = PROPS): Promise<Mounted> {
  SUMMARY_REQUESTS = [];
  PUBLISH_BODIES = [];
  const dialog = await mountPublishDialog(props);
  await dialog.settle();
  return dialog;
}

async function choose(dialog: Mounted, label: 'Hash only' | 'Include full prompt text'): Promise<void> {
  fire(dialog.inputLabelled(label), 'onChange');
  await dialog.settle();
}

const title = (dialog: Mounted) => dialog.titleInput().props.value as string;
const summary = (dialog: Mounted) => dialog.summaryField().props.value as string;
const today = () => new Date().toISOString().slice(0, 10);

// --- 5. The title ------------------------------------------------------------------

test('5: under hash-only visibility, the default title is neutral: the portal and the date, and no form of the question', async () => {
  const dialog = await open();
  await choose(dialog, 'Hash only');
  const value = title(dialog);
  assert.ok(value.includes(PORTAL), `the default title does not name the portal: ${JSON.stringify(value)}`);
  assert.ok(value.includes(today()), `the default title does not carry the date: ${JSON.stringify(value)}`);
  assert.ok(!carriesQuestion(value), `the default title carries the question: ${JSON.stringify(value)}`);
});

test('5: a run with no portal gets the portal its call named, and a run that names none still gets a neutral title', async () => {
  const named = await open({ ...PROPS, portal: '' });
  await choose(named, 'Hash only');
  assert.ok(title(named).includes(PORTAL), title(named));
  const none = await open({ ...PROPS, portal: '', toolCalls: [] });
  await choose(none, 'Hash only');
  assert.ok(title(none).includes(today()) && !carriesQuestion(title(none)) && title(none).trim() !== '', title(none));
});

test('5: switching the visibility updates a default the reader has not edited, both ways', async () => {
  const dialog = await open();
  assert.equal(title(dialog), QUESTION);
  await choose(dialog, 'Hash only');
  const neutral = title(dialog);
  assert.notEqual(neutral, QUESTION);
  await choose(dialog, 'Include full prompt text');
  assert.equal(title(dialog), QUESTION);
  await choose(dialog, 'Hash only');
  assert.equal(title(dialog), neutral);
});

test('5: a title the reader typed is kept as typed, under either visibility', async () => {
  const dialog = await open();
  const typed = 'My own words, including the question: ' + QUESTION;
  fire(dialog.titleInput(), 'onChange', { target: { value: typed } });
  await dialog.settle();
  await choose(dialog, 'Hash only');
  assert.equal(title(dialog), typed);
  await choose(dialog, 'Include full prompt text');
  assert.equal(title(dialog), typed);
  await choose(dialog, 'Hash only');
  await fire(dialog.button('Seal'), 'onClick');
  await dialog.settle();
  assert.equal(PUBLISH_BODIES[0]?.title, typed);
});

test('5: under full-text visibility the default title is the question, as before', async () => {
  assert.equal(title(await open()), QUESTION);
  assert.equal(title(await open({ ...PROPS, queryText: LONG_QUESTION })), `${LONG_QUESTION.slice(0, 77)}...`);
});

test('5: the title field says the title is public and becomes the record’s address', async () => {
  const text = (await open()).text();
  const field = text.indexOf('Title');
  const next = text.indexOf('Summary');
  const note = text.indexOf(TITLE_NOTE);
  assert.notEqual(note, -1, `the dialog does not say: ${TITLE_NOTE}\n${text.slice(0, 400)}`);
  assert.ok(field < note && note < next, 'the note is not beside the title field');
});

test('5: the published title under hash-only visibility is the neutral default', async () => {
  const dialog = await open();
  await choose(dialog, 'Hash only');
  const neutral = title(dialog);
  await fire(dialog.button('Seal'), 'onClick');
  await dialog.settle();
  assert.equal(PUBLISH_BODIES.length, 1);
  assert.equal(PUBLISH_BODIES[0].title, neutral);
  assert.ok(!carriesQuestion(PUBLISH_BODIES[0].title), 'the published title carries the question');
  assert.equal(PUBLISH_BODIES[0].promptVisibility, 'hash_only');
});

// --- 6. The words, and the summary request ------------------------------------------

test('6: the hash-only choice says what the record keeps and what may still carry the question’s words', async () => {
  const dialog = await open();
  const label = dialog.elements().find((el) => el.type === 'label' && textOf(el).includes('Hash only'));
  assert.ok(label, 'no hash-only choice');
  assert.ok(textOf(label!).includes(HASH_ONLY_WORDS), `the hash-only choice says: ${JSON.stringify(textOf(label!))}`);
});

test('6: under full-text visibility the summary request carries the question, as before', async () => {
  await open();
  assert.equal(SUMMARY_REQUESTS.length, 1);
  assert.equal(SUMMARY_REQUESTS[0].body.prompt, QUESTION);
});

test('6: after switching to hash-only visibility, the summary comes from a request that carried no form of the question', async () => {
  const dialog = await open();
  SUMMARY_REQUESTS[0].reply(SUMMARY_WITH_QUESTION_REQUEST);
  await dialog.settle();
  assert.equal(summary(dialog), SUMMARY_WITH_QUESTION_REQUEST, 'premise: the first reply was shown');
  await choose(dialog, 'Hash only');
  const after = SUMMARY_REQUESTS.slice(1);
  assert.ok(after.length >= 1, 'no summary request was made under hash-only visibility');
  for (const request of after) assert.ok(!carriesQuestion(request.body), `a summary request under hash-only visibility carried the question: ${JSON.stringify(request.body)}`);
  assert.notEqual(summary(dialog), SUMMARY_WITH_QUESTION_REQUEST, 'the summary drafted from the question still stands');
  for (const request of after) request.reply(SUMMARY_WITHOUT_QUESTION_REQUEST);
  await dialog.settle();
  assert.equal(summary(dialog), SUMMARY_WITHOUT_QUESTION_REQUEST);
  await fire(dialog.button('Seal'), 'onClick');
  await dialog.settle();
  assert.equal(PUBLISH_BODIES[0]?.summary, SUMMARY_WITHOUT_QUESTION_REQUEST);
});

test('6: a reply to the earlier request that arrives last does not replace the hash-only summary', async () => {
  const dialog = await open();
  const first = SUMMARY_REQUESTS[0];
  await choose(dialog, 'Hash only');
  const after = SUMMARY_REQUESTS.slice(1);
  assert.ok(after.length >= 1, 'no summary request was made under hash-only visibility');
  for (const request of after) request.reply(SUMMARY_WITHOUT_QUESTION_REQUEST);
  await dialog.settle();
  first.reply(SUMMARY_WITH_QUESTION_REQUEST);
  await dialog.settle();
  assert.equal(summary(dialog), SUMMARY_WITHOUT_QUESTION_REQUEST);
});

test('6: a summary the reader typed is kept, and no request replaces it', async () => {
  const dialog = await open();
  SUMMARY_REQUESTS[0].reply(SUMMARY_WITH_QUESTION_REQUEST);
  await dialog.settle();
  fire(dialog.summaryField(), 'onChange', { target: { value: 'Typed by the reader.' } });
  await dialog.settle();
  await choose(dialog, 'Hash only');
  for (const request of SUMMARY_REQUESTS.slice(1)) request.reply(SUMMARY_WITHOUT_QUESTION_REQUEST);
  await dialog.settle();
  assert.equal(summary(dialog), 'Typed by the reader.');
});
