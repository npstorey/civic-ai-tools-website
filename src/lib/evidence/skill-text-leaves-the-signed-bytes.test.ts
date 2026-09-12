// #411, ruling D3 (Wave N11 P4): the composed skill prompt leaves the signed
// bytes. The hash stays; the text goes.
//
// WHAT WAS WRONG, measured at 689e509. `src/app/api/compare-stream/route.ts`
// opened a `skill_fetch` span and ended it with `skill.text_hash` AND
// `skill.text` — the whole composed prompt, every source's skill file and
// every instruction in it. The harness's `extractSkillMetadata` reads that
// attribute into `skillMetadata.skillText`, and the trace goes INLINE into
// the package, so the prompt was inside the bytes this instance signs, on
// every record published from that route, permanently. The hash was already
// there beside it and is what a reader can actually use: anyone holding the
// composed prompt can prove it is the one the run used.
//
// THREE THINGS ARE HELD HERE, and the third is the one a span-level assertion
// cannot reach.
//
//   1. NO PRODUCER WRITES IT. A derived scan (D10 — a guard's universe comes
//      from `git ls-files`, never a hand list) over every tracked file of the
//      JavaScript/TypeScript family, tests excluded, wherever it sits.
//   2. A PACKAGE BUILT FROM THE SPAN THE ROUTE NOW WRITES CARRIES NO TEXT.
//      Driven through `buildEvidencePackage` and read from the stored bytes.
//      The fixture's attribute list is not written out here — it is PARSED
//      OUT OF THE ROUTE, so a producer that started writing the text again
//      would move this fixture rather than leave it pinned to a shape the
//      tree no longer has.
//   3. WHAT THE READER GETS INSTEAD. The record detail page renders
//      `SkillSection` from `skillMetadata.skillText`. D3 retires that section
//      for records published after this change — a reader-facing consequence
//      "no span carries the text" is satisfied by and cannot see. The page's
//      two render sites now ask `carriesSkillText`, and the built package is
//      driven through that same decision: `hash-only`, so no section renders,
//      and the hash is still disclosed to the reader by `ProvenanceChain`
//      under "Skill guidance". The control below builds the inline shape and
//      shows the decision going the other way, so the assertion is not
//      vacuous.
//
// WHAT DOES NOT MOVE. Records published BEFORE this change carry their text
// in signed bytes and keep rendering the section; nothing here or in the
// change edits a stored package. `skill.mcp_server_url` and
// `skill.data_commons_url` stay — they name the servers, not the prose.
//
// BLIND SPOTS, stated rather than assumed.
//   - The scan is TEXTUAL and matches an attribute-key literal. A producer
//     that built the key by concatenation, or wrote it under a variable, is
//     invisible to it; case 2 is the behavioural half that would still catch
//     such a producer for THIS route, and only for this route.
//   - Tests are excluded from the scan by filename, so a fixture may name the
//     attribute (this file's control does).
//   - The route's `POST` handler is not executed: it needs a session, rate
//     limiting and configured MCP routing. What is read from it is the
//     attribute list of its one `trace.endSpan(skillFetchSpanId, …)` call.
//   - `skillMetadataOverride` is a separate path into `skillMetadata.skillText`
//     (a publisher may hand a BlobRef). D3 is about the SPAN; the override is
//     out of scope here and the `inline` control is the shape it produces.
//   - No React component is rendered; the page's decision is asserted through
//     the exported function both of its sites call, plus a derived source
//     read that they call it.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types \
//        src/lib/evidence/skill-text-leaves-the-signed-bytes.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildEvidencePackage, type EvidencePackage, type PackageInput } from './packager.ts';
import { TraceBuilder, hash as traceHash, CIVICAITOOLS_TRACE_CONFIG } from './trace.ts';
import { describeSkillDisclosure, carriesSkillText } from './skill-disclosure.ts';
import { skillRoutingTraceAttributes } from '../mcp/registry.ts';
import { REFERENCE_IDENTITY_ENV } from './reference-identity-fixture.ts';

process.env.EVIDENCE_KEY_ID ??= 'platform:test-suite-kid';
process.env.PUBLISHER_KEY_ID ??= 'platform:test-suite-kid';
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) {
  process.env[name] ??= value;
}

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const ROUTE = 'src/app/api/compare-stream/route.ts';
/** A composed prompt long enough, and marked well enough, to be unmissable in the bytes. */
const SKILL_TEXT =
  'You are a civic data analyst. SENTINEL-SKILL-TEXT-N11-P4. Use the tools provided and cite every dataset.';

function tracked(): string[] {
  return execFileSync('git', ['ls-files', '--', '*.ts', '*.tsx', '*.mts', '*.cts', '*.js', '*.jsx', '*.mjs', '*.cjs'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
}

function sourceOf(relative: string): string {
  return readFileSync(new URL(relative, new URL('file://' + REPO_ROOT + '/')), 'utf8');
}

// --- 1: the derived scan ----------------------------------------------------

/** A line writing `'skill.text':` as an attribute key — the shape an `endSpan`
 *  call uses. `skill.text_hash` is a different key and is not matched. */
const WRITES_THE_TEXT = /['"]skill\.text['"]\s*:/;

test('#411: no tracked non-test file writes the composed prompt onto a span', () => {
  const files = tracked().filter((f) => !f.includes('.test.'));
  const offenders: string[] = [];
  for (const f of files) {
    sourceOf(f).split('\n').forEach((line, i) => {
      if (WRITES_THE_TEXT.test(line)) offenders.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(
    offenders,
    [],
    'a span attribute carries the whole composed prompt into the bytes this instance signs. ' +
      'D3 keeps the hash and drops the text',
  );
});

test('#411 GUARD ON THE GUARD: the scan reaches a real universe, and would flag the attribute if it were there', () => {
  const files = tracked().filter((f) => !f.includes('.test.'));
  assert.ok(files.length > 100, `the derived universe is implausibly small (${files.length} files) — the scan is not reading the tree`);
  assert.ok(files.includes(ROUTE), `${ROUTE} is not in the scanned universe, and it is the file the issue is about`);
  // The matcher, on the exact line the route used to carry and on the line it
  // still does. A scan that returns "none" because it matches nothing is the
  // failure mode this case exists for.
  assert.ok(WRITES_THE_TEXT.test("      'skill.text': systemPromptWithMcp,"), 'the matcher does not match the line it was written for');
  assert.equal(WRITES_THE_TEXT.test("      'skill.text_hash': systemPromptHash,"), false, 'the matcher must not flag the hash D3 keeps');
});

// --- 2: the package built from the span the route now writes ----------------

/**
 * The attribute keys the route's one `skill_fetch` `endSpan` call names,
 * parsed out of the route rather than restated. A fixture that stated its own
 * list would keep passing after a producer changed, which is the whole defect
 * class this phase is in.
 */
function routeSkillSpanShape(): { keys: string[]; spreadsRouting: boolean } {
  const source = sourceOf(ROUTE);
  const start = source.indexOf('trace.endSpan(skillFetchSpanId, {');
  assert.notEqual(start, -1, `${ROUTE} no longer ends a skill_fetch span the way this test parses — re-read it`);
  const end = source.indexOf('});', start);
  assert.notEqual(end, -1, `${ROUTE}: no close found for the endSpan call`);
  const body = source.slice(start, end);
  const keys = [...body.matchAll(/['"]([\w.]+)['"]\s*:/g)].map((m) => m[1]);
  return { keys, spreadsRouting: body.includes('...skillRoutingTraceAttributes(') };
}

test('#411 PREMISE: the route still ends the skill_fetch span, and what it names is the hash and the routing', () => {
  const { keys, spreadsRouting } = routeSkillSpanShape();
  assert.deepEqual(keys, ['skill.text_hash'], `the route's skill_fetch span names ${JSON.stringify(keys)}`);
  assert.ok(spreadsRouting, 'the routing attributes still travel — D3 drops the prose, not the server names');
});

/** A package built from a trace whose `skill_fetch` span carries exactly what
 *  the route writes, hashed over a prompt whose text is unmistakable. */
function builtFromRouteShape(): EvidencePackage {
  const { keys, spreadsRouting } = routeSkillSpanShape();
  const attributes: Record<string, string> = {};
  for (const key of keys) {
    // Every key the route names is filled with what the route fills it with.
    // The hash is the only one today; an unknown key is filled with the TEXT,
    // so a producer that reintroduced the prompt under any attribute name
    // puts it in front of the assertion below rather than past it.
    attributes[key] = key === 'skill.text_hash' ? traceHash(SKILL_TEXT) : SKILL_TEXT;
  }
  const builder = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
  builder.startRoot('analysis', { 'analysis.portal': 'data.cityofnewyork.us' });
  const skillSpan = builder.startSpan('skill_fetch', builder.rootSpanId);
  builder.endSpan(skillSpan, {
    ...attributes,
    ...(spreadsRouting
      ? skillRoutingTraceAttributes({
          socrataUrl: 'https://mcp.example.invalid/socrata',
          dataCommonsUrl: 'https://mcp.example.invalid/dc',
          bostonOpencontextUrl: 'https://mcp.example.invalid/boston',
        })
      : {}),
  });
  builder.endRoot();
  const input: PackageInput = {
    trace: builder.finalize() as unknown as PackageInput['trace'],
    prompt: 'How many 311 noise complaints were filed last year?',
    output: 'About 412,000.',
    toolCalls: [],
    model: 'openai/gpt-4o',
    portal: 'data.cityofnewyork.us',
    tokenUsage: { promptTokens: 10, completionTokens: 5 },
    promptVisibility: 'full_text',
    title: 'Skill text leaves the signed bytes',
    summary: 'Driven fixture for #411.',
    type: 'content/analysis/v1',
  };
  return buildEvidencePackage(input).pkg;
}

/** The package as storage hands it back, not the builder's return value. */
const BUILT = JSON.parse(JSON.stringify(builtFromRouteShape())) as EvidencePackage;

test('#411: the composed prompt is in no byte of a package built from the span the route writes', () => {
  assert.equal(
    JSON.stringify(BUILT).includes('SENTINEL-SKILL-TEXT-N11-P4'),
    false,
    'the whole prompt is in the package: extractSkillMetadata reads skill.text into ' +
      'skillMetadata.skillText and the trace travels inline',
  );
  assert.equal(BUILT.skillMetadata.skillText, undefined, 'and skillMetadata carries no text field');
});

test('#411: the hash D3 keeps is still in the signed bytes, and still identifies the prompt', () => {
  assert.equal(
    BUILT.skillMetadata.systemPromptHash,
    traceHash(SKILL_TEXT),
    'the hash is what survives the removal — without it the record says nothing at all about ' +
      'the prompt it ran under',
  );
});

// --- 3: what the record detail page does with it ----------------------------

test('#411: the page’s own decision for a package built after this change is hash-only — no skill section renders', () => {
  const disclosure = describeSkillDisclosure(BUILT.skillMetadata);
  assert.equal(disclosure.kind, 'hash-only', `the page would render the skill section from ${disclosure.kind}`);
  assert.equal(carriesSkillText(disclosure), false, 'there is no text for SkillSection to render');
  assert.equal(
    disclosure.kind === 'hash-only' ? disclosure.hash : undefined,
    BUILT.skillMetadata.systemPromptHash,
    'the hash travels with the decision — it is what ProvenanceChain still shows the reader',
  );
});

test('#411 CONTROL: a record published BEFORE this change still renders its section — the decision can go the other way', () => {
  const before = describeSkillDisclosure({ skillText: SKILL_TEXT, systemPromptHash: traceHash(SKILL_TEXT) });
  assert.equal(before.kind, 'inline');
  assert.equal(carriesSkillText(before), true, 'signed bytes already published are unchanged and still render');
  const blob = describeSkillDisclosure({
    skillText: { ref: 'blob:sha256:' + '0'.repeat(64), url: 'https://blobs.example.invalid/x', size: 12, contentType: 'text/plain' },
  });
  assert.equal(blob.kind, 'blob');
  assert.equal(carriesSkillText(blob), true, 'a BlobRef skill text is still a rendered section');
  assert.equal(describeSkillDisclosure(undefined).kind, 'none', 'a package recording neither states neither');
  assert.equal(describeSkillDisclosure({ skillText: '' }).kind, 'none', 'an empty string is not a prompt');
});

test('#411: every site that renders SkillSection asks that one decision — derived, not a named file', () => {
  const renderers = tracked()
    .filter((f) => !f.includes('.test.'))
    .filter((f) => f !== 'src/components/evidence/SkillSection.tsx')
    .filter((f) => sourceOf(f).includes('<SkillSection'));
  assert.ok(renderers.length > 0, 'no file renders SkillSection — the scan found nothing to hold');
  for (const f of renderers) {
    assert.ok(
      sourceOf(f).includes('carriesSkillText'),
      `${f} renders SkillSection behind its own condition. Both of the record page's sites asked ` +
        '`skillMetadata?.skillText || resolution?.skillTextIsBlob` longhand before P4; a condition ' +
        'written out in a page cannot be driven by a test, and "the section quietly disappeared" is ' +
        'what #411 changed for every record published after it',
    );
  }
});
