// UX-2 PW2, criterion 5 (#729, G0-4 B): the "record" class the research check
// read sentence by sentence (its Part 2, ruled by G0-10 R1, #729 comment
// 6690939748), at the two places no other suite renders: the site-wide
// running-unsigned banner, and the rows the ruling KEEPS on "record" because
// each is about the signed package itself.
//
// WHAT IS DRIVEN. The real `RunningUnsignedBanner` (a server component that
// reads the environment), rendered to static markup once per reason it
// states, under an environment set here: no signing key outside development
// (S10, which moves to "seal and publish") and a signing key with no key id
// (S9, which keeps "record"). The signing key is a presence-only stand-in, as
// `unsigned-tier.test.ts` uses one: the tier logic reads presence alone. The
// kept skill-section sentences (S21-S26) are read from `SYSTEM_PROMPT_TEXT`,
// the object every caller renders; the generated notebook's prose (S27) is
// the markdown `renderFetchToolCell` writes for a `get_data` call that named
// no portal on a run that carried none.
//
// WHAT MAKES IT ABLE TO FAIL. At the base S10 reads "so record seal and
// publish are disabled". The KEEP rows are no-change guards: green at the base
// and at the head, and failing if a later edit moves their noun.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SRC, h, readableText, registerSurfaceHooks } from './sources/surface-test-harness.ts';

registerSurfaceHooks({});

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const RunningUnsignedBanner = (await load('components/RunningUnsignedBanner.tsx')).default as ComponentType;
const { SYSTEM_PROMPT_TEXT } = await load('lib/sources/copy.ts');
const { renderFetchToolCell } = await load('lib/notebook-author/tool-to-cell.ts');

const SIGNING_NAMES = ['PUBLISHER_SIGNING_KEY', 'EVIDENCE_SIGNING_KEY', 'PUBLISHER_KEY_ID', 'EVIDENCE_KEY_ID', 'NODE_ENV'];

/** The banner as rendered under `env` (every signing variable cleared first), as a reader reads it. */
function bannerUnder(env: Record<string, string>): string {
  const before = new Map(SIGNING_NAMES.map((name) => [name, process.env[name]]));
  for (const name of SIGNING_NAMES) delete process.env[name];
  Object.assign(process.env, env);
  try {
    return readableText(renderToStaticMarkup(h(RunningUnsignedBanner)));
  } finally {
    for (const [name, value] of before) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

const S10_CLAUSE =
  'no signing key is configured, so seal and publish are disabled and any output produced here carries no cryptographic commitment';
const S9_KEPT = 'a record labeled with another deployment’s key id cannot verify and misattributes the publisher';

test('PW2 criterion 5 (S10): the running-unsigned banner says "seal and publish are disabled", with no "record"', () => {
  const text = bannerUnder({ NODE_ENV: 'production' });
  assert.ok(text.startsWith('Running unsigned — '), `premise: the no-signing-key banner renders: ${text}`);
  assert.ok(text.includes(S10_CLAUSE), `the banner reads: ${text}`);
  assert.ok(!/\brecords?\b/i.test(text), `the banner still says "record": ${text}`);
});

test('PW2 criterion 5 (S9, KEEP): the half-configured banner keeps "a record labeled with another deployment’s key id"', () => {
  const text = bannerUnder({ NODE_ENV: 'production', EVIDENCE_SIGNING_KEY: 'presence-only-stand-in' });
  assert.ok(text.startsWith('Signing is half-configured — '), `premise: the no-key-id banner renders: ${text}`);
  assert.ok(text.includes(S9_KEPT), `the banner reads: ${text}`);
});

// S21-S26 as the research check reads them at 473f3a7, kept on "record".
const SKILL_SECTION_KEPT = {
  notCarried: 'This record does not include the text of the system prompt (the instructions the model was given before the question).',
  notCarriedNorHash: 'This record does not include the text of the system prompt (the instructions the model was given before the question), or a hash of it.',
  componentsIntro: 'The record lists what the prompt was built from, with versions. Where a data source added its own instructions, a hash of them follows.',
  mismatch: 'The text found does not match the hash this record states, so it is not shown.',
  introBlob: 'The text of the system prompt the model was given, kept outside the signed record. It is shown only if it matches the hash this record states.',
  introInline: 'The text of the system prompt the model was given, as the signed record includes it.',
};

test('PW2 criterion 5 (S21-S26, KEEP): the skill section\'s six sentences keep "record"', () => {
  const read = Object.fromEntries(Object.keys(SKILL_SECTION_KEPT).map((key) => [key, SYSTEM_PROMPT_TEXT[key]]));
  assert.deepEqual(read, SKILL_SECTION_KEPT);
});

test('PW2 criterion 5 (S27, KEEP): the notebook\'s unnamed-portal step keeps "the record does not name the portal"', () => {
  const out = renderFetchToolCell(
    { name: 'get_data', args: { type: 'query', dataset_id: 'abcd-1234', query: 'SELECT count(*)' }, operationType: 'query' },
    { dataFrameIndex: 1, defaultPortal: '' },
  );
  assert.ok(out && out.cells.length > 0, 'premise: the call renders a cell');
  const md = out.cells.map((cell: { source: string | string[] }) => (Array.isArray(cell.source) ? cell.source.join('') : cell.source)).join('\n');
  assert.ok(md.includes('record does not name the portal it was queried on'), `the step reads: ${md}`);
});
